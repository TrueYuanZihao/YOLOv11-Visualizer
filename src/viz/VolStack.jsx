/* 3D 特征堆叠视图（three.js）
   - pyramid 模式：每一层的特征图当成一块「切片」，沿深度斜向堆成一摞，形成特征金字塔；
   - channels 模式：把选中层的若干通道叠成多层「地形图」，激活值直接做高度位移。
   支持拖拽旋转 / 滚轮缩放 / 点选层，右侧可调堆叠间距与起伏幅度。 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const BG = 0x0a0e16;

function disposeObj(obj) {
  obj.traverse((o) => {
    if (o.isCSS2DObject && o.element && o.element.parentNode) o.element.parentNode.removeChild(o.element);
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

export default function VolStack({
  items, mode = 'pyramid', explode = 1, heightScale = 1,
  showLabels = true, selectedKey, onSelect, autoRotate = false, resetSignal = 0,
}) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const optsRef = useRef({ explode, heightScale, showLabels, selectedKey });
  optsRef.current = { explode, heightScale, showLabels, selectedKey };

  /* ---------- 初始化：场景 / 相机 / 渲染器 / 光照 / 控制器 ---------- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.Fog(BG, 60, 220);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
    camera.position.set(18, 16, 46);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    host.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.left = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    host.appendChild(labelRenderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(12, 22, 16);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x66aaff, 1.1);
    rim.position.set(-16, -6, -14);
    scene.add(rim);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.7;

    const group = new THREE.Group();
    scene.add(group);

    const view = {
      scene, camera, controls, renderer, labelRenderer, group,
      meshes: [], raycaster: new THREE.Raycaster(), disposed: false,
    };
    viewRef.current = view;

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      labelRenderer.setSize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      if (view.autoRotate) group.rotation.y += 0.0035;
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    };
    loop();

    /* 点选：按下与抬起位置几乎一致才算「点击」，避免拖拽误触 */
    let down = null;
    const onDown = (e) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e) => {
      const wasDown = down;
      down = null;
      if (!wasDown) return;
      if (Math.abs(e.clientX - wasDown.x) + Math.abs(e.clientY - wasDown.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      view.raycaster.setFromCamera(ndc, camera);
      const hits = view.raycaster.intersectObjects(view.meshes.map((m) => m.mesh), false);
      if (hits.length) {
        const hit = view.meshes.find((m) => m.mesh === hits[0].object);
        if (hit && view.onSelect) view.onSelect(hit.key);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    view.autoRotate = false;
    /* 自动取景：把整个堆叠的 8 个包围盒角点投影到相机平面，
       反解出「刚好装下」的距离，避免用包围球导致的过度留白。 */
    view.frame = () => {
      const box = new THREE.Box3().setFromObject(group);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const dir = new THREE.Vector3(0.5, 0.3, 1).normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
      const up = new THREE.Vector3().crossVectors(dir, right).normalize();
      const fwd = dir.clone().negate();
      const tanV = Math.tan((camera.fov * Math.PI) / 360);
      const tanH = Math.max(1e-3, tanV * Math.max(0.2, camera.aspect));
      const u = new THREE.Vector3();
      let dist = 1;
      for (let i = 0; i < 8; i++) {
        u.set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).sub(center);
        const fu = u.dot(fwd);
        dist = Math.max(dist, Math.abs(u.dot(right)) / tanH - fu, Math.abs(u.dot(up)) / tanV - fu);
      }
      dist *= 1.06;
      camera.position.copy(center).addScaledVector(dir, dist);
      camera.near = Math.max(0.1, dist * 0.02);
      camera.far = dist * 8;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
      scene.fog.near = dist * 0.85;
      scene.fog.far = dist * 2.8;
    };

    return () => {
      view.disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      disposeObj(group);
      scene.remove(group);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      if (labelRenderer.domElement.parentNode) labelRenderer.domElement.parentNode.removeChild(labelRenderer.domElement);
      viewRef.current = null;
    };
  }, []);

  /* ---------- 数据变化：重建所有切片 / 地形 ---------- */
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.disposed) return;
    for (const m of view.meshes) { disposeObj(m.mesh); view.group.remove(m.mesh); }
    view.meshes = [];

    const list = items || [];
    if (!list.length) return;
    const { explode: ex, heightScale: hs } = optsRef.current;
    const isPyramid = mode === 'pyramid';
    const n = list.length;
    const mid = (n - 1) / 2;

    for (let i = 0; i < n; i++) {
      const it = list[i];
      const isSel = it.key === optsRef.current.selectedKey;
      const size = isPyramid ? it.size : it.size;
      const tex = new THREE.CanvasTexture(it.canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;

      let geom;
      const hasHeight = !!(it.plane && hs > 0);
      if (hasHeight) {
        const segX = Math.min(72, Math.max(1, it.W - 1));
        const segY = Math.min(72, Math.max(1, it.H - 1));
        geom = new THREE.PlaneGeometry(size, size, segX, segY);
        const pos = geom.attributes.position;
        const amp = size * 0.22 * hs;
        const plane = it.plane;
        for (let v = 0; v < pos.count; v++) {
          const col = v % (segX + 1);
          const row = Math.floor(v / (segX + 1));
          // PlaneGeometry 的顶点是从左下角开始按行排列的
          const px = Math.min(it.W - 1, Math.round((col / segX) * (it.W - 1)));
          const py = Math.min(it.H - 1, Math.round(((segY - row) / segY) * (it.H - 1)));
          pos.setZ(v, plane[py * it.W + px] * amp);
        }
        pos.needsUpdate = true;
        geom.computeVertexNormals();
      } else {
        geom = new THREE.PlaneGeometry(size, size, 1, 1);
      }

      const mat = new THREE.MeshLambertMaterial({
        map: tex, side: THREE.DoubleSide, emissive: 0x000000,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.userData.key = it.key;
      mesh.userData.baseZ = 0;
      const dz = isPyramid ? 2.1 * ex : 1.05 * ex;
      const dy = isPyramid ? 1.15 * ex : 0.5 * ex;
      mesh.position.set(0, (i - mid) * dy, -(i - mid) * dz);
      if (isSel) mat.emissive.setHex(0x2a4a7a);
      view.group.add(mesh);
      view.meshes.push({ mesh, key: it.key, item: it });

      if (optsRef.current.showLabels) {
        const el = document.createElement('div');
        const side = i % 2 === 0 ? 1 : -1;
        el.className = 'v3d-label ' + (side > 0 ? 'v3d-label-r' : 'v3d-label-l');
        el.innerHTML = '<b>' + it.label + '</b>' + (it.sub ? '<i>' + it.sub + '</i>' : '');
        const lbl = new CSS2DObject(el);
        lbl.position.set(side * (size / 2 + 0.9), size / 2 + 0.4, 0);
        mesh.add(lbl);
        mesh.userData.label = lbl;
      }
    }
    view.frame();
  }, [items, mode]);
  /* ---------- 交互与外观的增量更新 ---------- */
  useEffect(() => {
    const view = viewRef.current;
    if (view) view.onSelect = onSelect;
  });

  useEffect(() => {
    const view = viewRef.current;
    if (view) view.autoRotate = !!autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    for (const m of view.meshes) {
      if (m.key === selectedKey) {
        m.mesh.material.emissive.setHex(0x2a4a7a);
        m.mesh.renderOrder = 2;
      } else {
        m.mesh.material.emissive.setHex(0x000000);
      }
    }
  }, [selectedKey]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.disposed) return;
    const n = view.meshes.length;
    if (!n) return;
    const mid = (n - 1) / 2;
    const isPyramid = mode === 'pyramid';
    const dz = isPyramid ? 2.1 * explode : 1.05 * explode;
    const dy = isPyramid ? 1.15 * explode : 0.5 * explode;
    view.meshes.forEach((m, i) => {
      m.mesh.position.set(0, (i - mid) * dy, -(i - mid) * dz);
    });
  }, [explode, mode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.disposed) return;
    view.frame();
  }, [resetSignal]);

  const hasData = !!(items && items.length);
  return (
    <div className="v3d" ref={hostRef}>
      <div className="v3d-hint">
        拖拽旋转 · 滚轮缩放 · 右键平移 · 点击切片可切换选中层
      </div>
      {!hasData ? <div className="v3d-empty">等待推理结果…</div> : null}
    </div>
  );
}
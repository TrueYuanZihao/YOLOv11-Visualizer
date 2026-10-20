/* 新手引导：高亮真实控件，先让用户完成一个动作，再解释这个动作背后的概念。

   它不是一张静态说明书：需要点击 / 悬停 / 改参数的步骤会等待真实状态变化；
   打开结构图、层间关系、检测头解剖后，同一张卡片会切换成“观察模式”，
   离开该步时再自动关闭浮层，避免把用户留在全屏视图里。 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const STEPS = [
  {
    id: 'welcome',
    chapter: '起点',
    title: '先别急着看懂所有面板',
    body: (
      <>
        <p>
          这个工作台展示的是一次<strong>真实 ONNX 前向</strong>，不是示意图。
          接下来会用一组小任务，带你从“选一层”走到“看懂一次检测”。
        </p>
        <div className="tour-points">
          <span>高亮的是可以操作的真实控件</span>
          <span>完成动作后，卡片才允许继续</span>
          <span>随时退出，顶栏可以再次打开</span>
        </div>
      </>
    ),
    placement: 'center',
  },
  {
    id: 'topbar',
    chapter: '界面地图',
    title: '先认路：换图、深入视图与模型状态',
    body: (
      <>
        <p>
          顶栏左侧负责输入：选择本地图片，或继续使用示例图。中间三个按钮分别是
          <b>网络结构图</b>、<b>层间关系</b>和<b>检测头解剖</b>。
        </p>
        <p>右侧的状态标签会告诉你模型尺寸、类别数和本次前向是否完成。</p>
      </>
    ),
    target: '[data-tour="topbar-actions"]',
    placement: 'bottom',
  },
  {
    id: 'pipeline',
    chapter: '读懂单层',
    title: '左侧流水线：模型里的 27 个检查点',
    body: (
      <>
        <p>
          左侧按 Backbone / Neck / Head 分组。每一行都是一层，右侧细条表示这一层的
          RMS 激活强度；出现 <code>← m6 + m11</code> 时，说明该层吃进了多路输入。
        </p>
        <p><b>m12</b> 是颈部的一次通道拼接，适合观察不同来源的特征如何合并。</p>
      </>
    ),
    target: '[data-tour-layer="m12"]',
    actionText: '点击高亮行 m12',
    done: (ctx) => ctx.selId === 'm12',
  },
  {
    id: 'heatmap',
    chapter: '读懂单层',
    title: '2D 热力图：这一层究竟“点亮”了哪里',
    body: (
      <>
        <p>
          颜色表示张量的真实数值，不是目标类别。鼠标停在画布上，可以读取当前格点的激活值；
          打开“叠加原图”后，能判断强响应落在图像的哪一块区域。
        </p>
        <p className="tour-note">注意：不同层的分辨率、通道数不同，亮度不能脱离色标区间直接比较。</p>
      </>
    ),
    target: '[data-tour="feature-canvas"]',
    actionText: '把鼠标移到热力图上，读取一个像素值',
    event: 'pointermove',
  },
  {
    id: 'right-rail',
    chapter: '读懂单层',
    title: '右侧不是设置菜单，而是实验读数区',
    body: (
      <>
        <p>
          上方控制配色、伽马、叠加和检测阈值；中部是本次检测结果；底部是选中层的统计与通道能量排行。
        </p>
        <p>
          置信度与 NMS IoU 只影响检测框解码，改它们<strong>不会重跑网络</strong>，所以可以放心拖动。
        </p>
      </>
    ),
    target: '[data-tour="right-rail"]',
    watch: '[data-tour="colormap"]',
    event: 'change',
    actionText: '把“配色”改成 Turbo（或任意其他配色）',
    placement: 'left',
  },
  {
    id: 'views',
    chapter: '读懂单层',
    title: '同一层，换一种看法',
    body: (
      <>
        <p>
          2D 看空间位置；通道网格找能量最高的通道；3D 特征金字塔比较所有层的分辨率和通道规模；
          3D 通道堆叠则把单层通道摊成地形。
        </p>
        <p>先切到“3D 特征金字塔”，看一下整个模型从高分辨率到低分辨率的变化。</p>
      </>
    ),
    target: '[data-tour="view-tabs"]',
    actionText: '点击「3D 特征金字塔」',
    done: (ctx) => ctx.view === 'pyramid',
    placement: 'bottom',
  },
  {
    id: 'structure',
    chapter: '深入网络',
    title: (ctx) => (ctx.structureOpen ? '结构图：连边来自 ONNX，不是手绘示意' : '把逐层浏览升级成完整拓扑'),
    body: (ctx) => (
      ctx.structureOpen ? (
        <>
          <p>
            节点按 Backbone / Neck / Head 分区，连边来自真实 ONNX 计算图。
            点任意节点可以看形状、统计和上游来源；紫色线是跨层跳连。
          </p>
          <p className="tour-note">滚轮缩放、拖背景平移、拖节点摆位。读完后点“继续”，浮层会自动关闭。</p>
        </>
      ) : (
        <>
          <p>
            左侧流水线只能表达顺序，无法表现“哪一层跳过了中间层，直接接到了后面”。
            完整结构图把真实拓扑摊开，是理解 YOLO11 的关键视图。
          </p>
        </>
      )
    ),
    target: (ctx) => (ctx.structureOpen ? '.graphview' : '[data-tour="structure-open"]'),
    placement: (ctx) => (ctx.structureOpen ? 'corner' : 'bottom'),
    actionText: (ctx) => (ctx.structureOpen
      ? '结构图已打开：点一两个节点观察来源与统计'
      : '点击顶栏的「网络结构图」'),
    done: (ctx) => ctx.structureOpen,
  },
  {
    id: 'relations',
    chapter: '深入网络',
    title: (ctx) => (ctx.relOpen ? '层间关系：比较两层，拆开一条跳连' : '看看层与层之间怎样交换信息'),
    body: (ctx) => (
      ctx.relOpen ? (
        <>
          <p>
            <b>A/B 对比</b>把两层放在同一坐标系里，缩放、平移和鼠标探针同步；
            <b>跳连拆解</b>把 Concat 的通道来源逐段拆开，并用真实激活验证“只是搬运、没有计算”。
          </p>
          <p className="tour-note">左侧还有常见对照预设，例如 Upsample 前后、Concat 前后。</p>
        </>
      ) : (
        <>
          <p>
            单层热力图只能回答“这一层有什么”。层间关系进一步回答：
            <b>哪一层的哪一段通道，进入了哪一层</b>。
          </p>
        </>
      )
    ),
    target: (ctx) => (ctx.relOpen ? '.lr-center' : '[data-tour="relations-open"]'),
    placement: (ctx) => (ctx.relOpen ? 'corner' : 'bottom'),
    actionText: (ctx) => (ctx.relOpen
      ? '层间关系已打开：试试左侧的常见对照或跳连拆解'
      : '点击顶栏的「层间关系」'),
    done: (ctx) => ctx.relOpen,
  },
  {
    id: 'head',
    chapter: '追踪检测',
    title: (ctx) => (ctx.headOpen ? '检测头解剖：从 2100 个锚点到最终框' : '最后一步：检测框是怎么被“选出来”的'),
    body: (ctx) => (
      ctx.headOpen ? (
        <>
          <p>
            左侧四步依次是：三路特征分支 → 锚点网格 → 置信度筛选 → NMS 抑制。
            点任意格点可读取它的框坐标和 80 类分数；改阈值不会重新推理。
          </p>
          <p className="tour-note">中间的琥珀色框表示锚点，绿色是保留框，红色虚线是 NMS 压掉的重复框。</p>
        </>
      ) : (
        <>
          <p>
            前面的层显示的是“特征”，这里展示特征如何变成框：每个格点独立预测一个框和一套类别分数，
            再经过阈值和 NMS 选出最终结果。
          </p>
        </>
      )
    ),
    target: (ctx) => (ctx.headOpen ? '.dh-center' : '[data-tour="head-open"]'),
    placement: (ctx) => (ctx.headOpen ? 'corner' : 'bottom'),
    actionText: (ctx) => (ctx.headOpen
      ? '检测头已打开：点一个锚点格点，看看它的类别分数'
      : '点击顶栏的「检测头解剖」'),
    done: (ctx) => ctx.headOpen,
  },
  {
    id: 'replay',
    chapter: '追踪检测',
    title: '让整条链路自己走一遍',
    body: (
      <>
        <p>
          “前向回放”会从 input 走到 output，再继续走进检测头的锚点、候选框和 NMS 阶段。
          左侧流水线同步高亮，当前阶段也会显示在视口顶部。
        </p>
        <p className="tour-note">空格键播放 / 暂停，← → 单步，时间轴上的任意一段都可以直接点。</p>
      </>
    ),
    target: '[data-tour="replay-play"]',
    actionText: '点击「▶ 前向回放」',
    done: (ctx) => ctx.replayPlaying,
  },
  {
    id: 'done',
    chapter: '完成',
    title: '主路径已经走通',
    body: (
      <>
        <p>
          你现在已经知道：左侧选层，中间看激活，右侧调参数和读结果；
          结构图、层间关系、检测头解剖分别回答“网络怎么连”“层怎么交互”“框怎么产生”。
        </p>
        <div className="tour-points">
          <span>先用左侧定位一层</span>
          <span>再用右侧确认数值和检测结果</span>
          <span>遇到跨层现象时打开两个深入视图</span>
        </div>
      </>
    ),
    placement: 'center',
    nextLabel: '完成导览',
  },
];

const CARD_MARGIN = 18;
const VIEWPORT_PAD = 12;

function valueOf(v, ctx) {
  return typeof v === 'function' ? v(ctx) : v;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function placeCard(rect, card, placement) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = card.w || 380;
  const h = card.h || 320;

  if (!rect || placement === 'center') {
    return { left: Math.max(VIEWPORT_PAD, (vw - w) / 2), top: Math.max(VIEWPORT_PAD, (vh - h) / 2) };
  }
  if (placement === 'corner') {
    return { left: CARD_MARGIN, top: Math.max(VIEWPORT_PAD, vh - h - CARD_MARGIN) };
  }

  const rightRoom = vw - rect.right - CARD_MARGIN * 2;
  const leftRoom = rect.left - CARD_MARGIN * 2;
  const bottomRoom = vh - rect.bottom - CARD_MARGIN * 2;
  const topRoom = rect.top - CARD_MARGIN * 2;
  let side = placement;
  if (side === 'auto') {
    if (rightRoom >= w) side = 'right';
    else if (leftRoom >= w) side = 'left';
    else if (bottomRoom >= h) side = 'bottom';
    else if (topRoom >= h) side = 'top';
    else side = rightRoom > leftRoom ? 'right' : 'left';
  }

  if (side === 'right') {
    return {
      left: clamp(rect.right + CARD_MARGIN, VIEWPORT_PAD, vw - w - VIEWPORT_PAD),
      top: clamp(rect.top + rect.height / 2 - h / 2, VIEWPORT_PAD, vh - h - VIEWPORT_PAD),
    };
  }
  if (side === 'left') {
    return {
      left: clamp(rect.left - w - CARD_MARGIN, VIEWPORT_PAD, vw - w - VIEWPORT_PAD),
      top: clamp(rect.top + rect.height / 2 - h / 2, VIEWPORT_PAD, vh - h - VIEWPORT_PAD),
    };
  }
  if (side === 'top') {
    return {
      left: clamp(rect.left + rect.width / 2 - w / 2, VIEWPORT_PAD, vw - w - VIEWPORT_PAD),
      top: clamp(rect.top - h - CARD_MARGIN, VIEWPORT_PAD, vh - h - VIEWPORT_PAD),
    };
  }
  return {
    left: clamp(rect.left + rect.width / 2 - w / 2, VIEWPORT_PAD, vw - w - VIEWPORT_PAD),
    top: clamp(rect.bottom + CARD_MARGIN, VIEWPORT_PAD, vh - h - VIEWPORT_PAD),
  };
}

export default function GuidedTour({ ctx, onLeaveStep, onStepEnter, onClose, onFinish }) {
  const [index, setIndex] = useState(0);
  const [interacted, setInteracted] = useState(false);
  const [targetRect, setTargetRect] = useState(null);
  const [cardSize, setCardSize] = useState({ w: 380, h: 320 });
  const cardRef = useRef(null);
  const step = STEPS[index];

  const targetSelector = valueOf(step.target, ctx) || null;
  const watchSelector = valueOf(step.watch || step.target, ctx) || null;
  const placement = valueOf(step.placement || 'auto', ctx);
  const title = valueOf(step.title, ctx);
  const body = valueOf(step.body, ctx);
  const actionText = valueOf(step.actionText, ctx);
  const nextLabel = valueOf(step.nextLabel, ctx)
    || (index === STEPS.length - 1 ? '完成导览' : '下一步');
  const requiresAction = !!(step.event || step.done);
  const completed = step.event ? interacted : (!step.done || !!step.done(ctx));
  const canContinue = !requiresAction || completed;

  useEffect(() => {
    setInteracted(false);
  }, [index]);

  useEffect(() => {
    if (onStepEnter) onStepEnter(step.id, index);
  }, [index, onStepEnter, step.id]);

  useLayoutEffect(() => {
    setTargetRect(null);
    if (!targetSelector) return undefined;
    let disposed = false;
    let frame = 0;
    const update = () => {
      if (disposed) return;
      const el = document.querySelector(targetSelector);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setTargetRect({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
    };
    const el = document.querySelector(targetSelector);
    if (el && el.scrollIntoView) {
      const r = el.getBoundingClientRect();
      if (r.top < 54 || r.bottom > window.innerHeight - 12) {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      }
    }
    frame = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [index, targetSelector]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return undefined;
    const measure = () => setCardSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, targetSelector, completed]);

  useEffect(() => {
    if (!step.event) return undefined;
    let timer = 0;
    let cleanup = null;
    const attach = () => {
      const node = document.querySelector(watchSelector);
      if (!node) { timer = window.setTimeout(attach, 80); return; }
      const handler = () => setInteracted(true);
      node.addEventListener(step.event, handler);
      cleanup = () => node.removeEventListener(step.event, handler);
    };
    attach();
    return () => {
      window.clearTimeout(timer);
      if (cleanup) cleanup();
    };
  }, [index, step.event, watchSelector]);

  const next = () => {
    if (index >= STEPS.length - 1) {
      onFinish();
      return;
    }
    if (onLeaveStep) onLeaveStep();
    setIndex((i) => i + 1);
    setInteracted(false);
  };

  const prev = () => {
    if (index <= 0) return;
    if (onLeaveStep) onLeaveStep();
    setIndex((i) => i - 1);
    setInteracted(false);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowRight' && canContinue) {
        e.preventDefault();
        e.stopPropagation();
        next();
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        e.stopPropagation();
        prev();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const cardPos = useMemo(
    () => placeCard(targetRect, cardSize, placement),
    [targetRect, cardSize, placement],
  );

  const spotStyle = targetRect ? {
    left: Math.max(0, targetRect.left - 6),
    top: Math.max(0, targetRect.top - 6),
    width: Math.max(14, targetRect.width + 12),
    height: Math.max(14, targetRect.height + 12),
  } : null;

  return (
    <div className="tour-layer" role="dialog" aria-label="新手引导">
      {!spotStyle ? <div className="tour-shade" /> : null}
      {spotStyle ? <div className="tour-spot" style={spotStyle} aria-hidden="true" /> : null}
      <div
        ref={cardRef}
        className={requiresAction && !completed ? 'tour-card is-waiting' : 'tour-card'}
        style={{ left: cardPos.left, top: cardPos.top }}
        role="document"
      >
        <div className="tour-card-top">
          <span className="tour-chapter">{step.chapter}</span>
          <span className="tour-progress">{index + 1} / {STEPS.length}</span>
          <button type="button" className="tour-close" onClick={onClose} aria-label="退出引导">x</button>
        </div>
        <div className="tour-progressbar"><i style={{ width: (index + 1) / STEPS.length * 100 + '%' }} /></div>
        <h3 className="tour-title">{title}</h3>
        <div className="tour-body">{body}</div>

        {actionText ? (
          <div className={completed ? 'tour-action is-done' : 'tour-action'}>
            <span className="tour-action-k">{completed ? '已完成' : '试一试'}</span>
            <span>{actionText}</span>
          </div>
        ) : null}

        <div className="tour-foot">
          <button type="button" className="tour-link" onClick={onClose}>退出引导</button>
          <span className="tour-foot-spacer" />
          {index > 0 ? <button type="button" className="tour-back" onClick={prev}>上一步</button> : null}
          {requiresAction && !completed ? (
            <button type="button" className="tour-link" onClick={next}>跳过本步</button>
          ) : null}
          <button type="button" className="tour-next" disabled={!canContinue} onClick={next}>
            {nextLabel}
          </button>
        </div>
        {requiresAction && !completed ? (
          <div className="tour-wait">先完成高亮区域里的操作，或者选择“跳过本步”。</div>
        ) : null}
      </div>
    </div>
  );
}

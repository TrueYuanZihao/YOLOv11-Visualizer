/* 前向回放的「检测头阶段」：把 output0 之后的解码链路也接进时间轴。

   层的回放走到 output 就断了，但真正的检测还没开始：output0 只是 2100 个锚点的预测，
   还要经过「置信度筛选 -> 逐类 NMS -> 反算回原图」才会变成右边面板里那几个框。
   这个模块把这段链路切成若干「阶段」，并给出每个阶段该画哪些框、框处于什么状态，
   供中间视口的 HeadStage 画布使用 —— 数据全部来自同一次前向的 output0，
   与「检测头解剖」页面共用 model/detect.js 的解码实现，所以两处的框一定对得上。 */
import { decodeCandidates, nmsTrace } from './detect.js';
import { scaleGrids, BOX_CHANNELS } from './headAnatomy.js';

/** NMS 阶段最多切成几段：一段推进若干次抑制，太快会看不清谁压掉了谁 */
export const NMS_CHUNKS = 8;

/** 检测头阶段的主题色（和 backbone / neck / head 三组都不同，一眼看出「这不再是层」） */
export const HEAD_COLOR = '#ffb84d';

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

/* 候选框按类别上色：图上叠着的一堆框，大多来自同一个目标的不同格点 —— 同色即同类 */
const CLASS_COLOR = ['#ffb84d', '#4ea3ff', '#3ee6a4', '#c78bff', '#ff9bd2', '#f2f56b', '#57d9e0'];

const clsName = (classNames, id) => (classNames && classNames[id]) || '#' + id;
const pct = (s) => (s * 100).toFixed(0) + '%';

/**
 * 把 output0 之后的链路切成阶段。返回 null 表示还没有前向结果。
 *   stages  —— 依次是：锚点网格 / 置信度筛选 / NMS 抑制 × k / 最终输出
 *   cands   —— 解码出的候选框（按分数降序）
 *   trace   —— NMS 的保留与抑制日志
 *   units   —— 把「保留一个框 / 压掉一个框」摊平后的动作序列（NMS 阶段就是按它切的）
 */
export function buildHeadReplay({ output, imgsz, conf, iou, maxDet = 100, preNmsTop = 300 }) {
  if (!output || !output.dims || output.dims.length < 3) return null;

  const candRes = decodeCandidates(output, { conf, preNmsTop });
  const trace = nmsTrace(candRes.cands, { iou, maxDet });
  const grids = scaleGrids(imgsz);
  const cands = candRes.cands;
  const log = trace.log;

  /* 把抑制过程摊成「动作」序列：保留一个框算一个动作，压掉一个框也算一个动作。
     这张图整幅只有两三次保留，如果按「第几步」切就只有两三段，看不出抑制的过程；
     按动作切才能把「一个框压掉周围 8 个重复框」拆开慢慢放。 */
  const units = [];
  for (let s = 0; s < log.length; s++) {
    units.push({ keep: true, index: log[s].keep });
    for (const k of log[s].kills) units.push({ keep: false, index: k });
  }

  const stages = [];

  stages.push({
    key: 'head:anchors',
    kind: 'anchors',
    label: '锚点网格',
    sub: grids.map((g) => g.gw + '×' + g.gh).join(' / '),
    readout: candRes.n + ' 个锚点 · 每格 ' + (BOX_CHANNELS + candRes.nc) + ' 个数',
    desc: '检测头不做特征提取：它把颈部给的三张特征图（P3 / P4 / P5）分别投影成预测，'
      + '特征图的每个位置各给一次预测。' + grids.map((g) => g.gw + '×' + g.gh).join(' + ') + ' = ' + candRes.n + ' 个锚点，'
      + '每个锚点 ' + BOX_CHANNELS + ' 个框回归量 + ' + candRes.nc + ' 个类别分数，'
      + '拼起来就是 output0 的 [1, ' + (BOX_CHANNELS + candRes.nc) + ', ' + candRes.n + ']。',
  });

  stages.push({
    key: 'head:cand',
    kind: 'cand',
    label: '置信度筛选',
    sub: '分数 ≥ ' + conf.toFixed(2),
    readout: cands.length + ' 个候选框',
    desc: '每个锚点取分数最高的那个类，只有 ≥ ' + conf.toFixed(2) + ' 的才留成候选，'
      + '这里留下 ' + cands.length + ' 个。一个目标周围的许多格子会同时响应，框还互相叠着 —— '
      + '候选框远多于真实目标（' + (cands.length >= preNmsTop ? '按分数截断到前 ' + preNmsTop + ' 个' : '还没到截断上限') + '）。',
  });

  const chunks = Math.min(NMS_CHUNKS, units.length);
  for (let c = 0; c < chunks; c++) {
    const from = Math.floor((c * units.length) / chunks);
    const to = Math.floor(((c + 1) * units.length) / chunks);
    if (to <= from) continue;
    let kept = 0;
    let drops = 0;
    for (let u = from; u < to; u++) { if (units[u].keep) kept++; else drops++; }
    stages.push({
      key: 'head:nms:' + c,
      kind: 'nms',
      from,
      to,
      upto: to,
      label: 'NMS 抑制 ' + (CIRCLED[c] || '#' + (c + 1)),
      sub: '抑制进度 ' + Math.round((to / units.length) * 100) + '%',
      readout: '留 ' + kept + ' · 压 ' + drops,
      desc: '逐类贪心抑制：按分数从高到低走，留下当前框（绿），把同类且 IoU > ' + iou.toFixed(2)
        + ' 的重复框压掉（红虚线）。被压掉不等于预测错 —— 只是同一个目标不需要两个框。'
        + '这一步不跨类互压，所以人和自行车即使叠在一起也能同时留下。'
        + '（这一段：保留 ' + kept + ' 个，压掉 ' + drops + ' 个；'
        + '一共 ' + log.length + ' 次保留、' + (units.length - log.length) + ' 个框被压掉）',
    });
  }

  stages.push({
    key: 'head:final',
    kind: 'final',
    label: '最终输出',
    sub: '反算回原图',
    readout: trace.keep.length + ' 个框',
    desc: '抑制结束后剩下的 ' + trace.keep.length + ' 个框就是最终检测结果，'
      + '坐标再按 letterbox 的缩放与偏移反算回原图 —— 右边「检测结果」面板里的就是它们，'
      + '和这张图上画的是同一份数据。',
  });

  return { stages, cands, trace, units };
}

/** 某个阶段该画哪些框、每个框什么状态（配色含义与「检测头解剖」页完全一致） */
export function boxesForStage(stage, model, classNames) {
  const out = [];
  if (!stage || !model) return out;
  const { cands, trace } = model;
  const label = (c) => clsName(classNames, c.classId) + ' ' + pct(c.score);

  if (stage.kind === 'cand') {
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      out.push({
        ...c,
        state: 'pend',
        color: CLASS_COLOR[c.classId % CLASS_COLOR.length],
        width: 1.7,
        forceLabel: i < 5,
        label: i < 5 ? label(c) : '',
      });
    }
    return out;
  }

  if (stage.kind === 'final') {
    for (const i of trace.keep) out.push({ ...cands[i], state: 'keep', label: label(cands[i]) });
    return out;
  }

  if (stage.kind === 'nms') {
    const units = model.units || [];
    const upto = Math.min(stage.upto, units.length);
    const st = new Array(cands.length).fill('pend');
    for (let u = 0; u < upto; u++) {
      st[units[u].index] = units[u].keep ? 'keep' : 'drop';
    }
    /* 蓝框 = 接下来要判定的那个保留动作（还没轮到） */
    for (let u = upto; u < units.length; u++) {
      if (units[u].keep) { st[units[u].index] = 'now'; break; }
    }
    for (let i = 0; i < cands.length; i++) {
      const s = st[i];
      out.push({ ...cands[i], state: s, label: (s === 'keep' || s === 'now') ? label(cands[i]) : '' });
    }
    return out;
  }

  return out;
}

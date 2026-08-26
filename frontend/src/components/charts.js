/**
 * Chart.js registration, a value-label plugin, and theme-aware option builders.
 *
 * Canvas cannot inherit CSS, so every colour comes from the tokens sampled off
 * the stylesheet (see ThemeContext) — one palette definition, two themes.
 *
 * Charts here are directly labelled, which makes the value axis redundant: the
 * grid and its ticks are dropped wherever a label already states the number.
 */
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import { axisNumber } from '../lib/format'

const LABEL_FONT = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif'

/**
 * Draws the value beside each mark.
 *
 * Bars and stacked segments get every value — the categories are few enough
 * that this reads as a table rather than clutter. Lines label only the final
 * point of each series, so a long history does not become a wall of digits.
 * A stacked segment is labelled only when the text actually fits inside it.
 */
const valueLabels = {
  id: 'valueLabels',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.display === false) return
    const { ctx } = chart
    const format = opts.formatter || ((v) => axisNumber(v))
    const mode = opts.mode || 'bar'

    ctx.save()
    ctx.font = LABEL_FONT

    // Grouped bars put three labels over one category, which collide as soon
    // as the values are wide ("2,0732,056"). Label the leading series only and
    // let the legend and tooltip carry the rest.
    const visible = chart.data.datasets.filter(
      (_d, i) => !chart.getDatasetMeta(i).hidden
    ).length
    const primaryOnly = mode === 'bar' && visible > 1
    // Widest a label may be before it would run into its neighbour.
    const slot =
      chart.chartArea && chart.data.labels?.length
        ? chart.chartArea.width / chart.data.labels.length - 6
        : Infinity

    chart.data.datasets.forEach((dataset, di) => {
      const meta = chart.getDatasetMeta(di)
      if (meta.hidden) return
      if (primaryOnly && di !== 0) return

      meta.data.forEach((element, i) => {
        const raw = dataset.data[i]
        if (raw === null || raw === undefined) return
        if (mode === 'line-end' && i !== dataset.data.length - 1) return
        if (mode !== 'stack' && !raw) return

        const text = format(raw)
        if (!text || text === '-') return
        if (mode === 'bar' && ctx.measureText(text).width > slot) return

        if (mode === 'arc') {
          // Only label a slice wide enough to hold the text inside the ring.
          const sweep = Math.abs(element.endAngle - element.startAngle)
          if (sweep < 0.42) return
          const { x, y } = element.getCenterPoint()
          ctx.fillStyle = '#fff'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(text, x, y)
          return
        }

        if (mode === 'stack') {
          // Only label a segment tall enough to hold the text with padding.
          const height = Math.abs(element.y - element.base)
          if (height < 18) return
          ctx.fillStyle = '#fff'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(text, element.x, (element.y + element.base) / 2)
          return
        }

        ctx.fillStyle = opts.color || '#52606d'
        if (mode === 'hbar') {
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          ctx.fillText(text, element.x + 6, element.y)
        } else if (mode === 'line-end') {
          ctx.textAlign = 'right'
          ctx.textBaseline = 'bottom'
          ctx.fillStyle = dataset.borderColor || ctx.fillStyle
          ctx.fillText(text, element.x - 4, element.y - 7)
        } else {
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.fillText(text, element.x, element.y - 5)
        }
      })
    })
    ctx.restore()
  },
}

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler,
  valueLabels
)

const FALLBACK = {
  surface: '#ffffff',
  ink: '#101828',
  ink2: '#52606d',
  ink3: '#7d8794',
  grid: '#eceff3',
  axis: '#c3c2b7',
  series: ['#2a78d6', '#eb6834', '#1baf7a'],
  good: '#0ca30c',
  critical: '#d03b3b',
}

export function tokensOr(tokens) {
  return tokens?.series?.[0] ? tokens : FALLBACK
}

/** Bars: thin, 4px rounded data-end, anchored to the baseline. */
export const BAR_MARK = {
  borderRadius: 4,
  borderSkipped: 'start',
  maxBarThickness: 46,
}

function legend(t, show) {
  return {
    display: show,
    position: 'top',
    align: 'end',
    labels: {
      color: t.ink2,
      boxWidth: 10,
      boxHeight: 10,
      usePointStyle: true,
      pointStyle: 'circle',
      padding: 14,
      font: { size: 11 },
    },
  }
}

function tooltip(t, formatValue) {
  return {
    backgroundColor: t.surface,
    titleColor: t.ink,
    bodyColor: t.ink2,
    borderColor: t.grid,
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
    displayColors: true,
    boxWidth: 8,
    boxHeight: 8,
    usePointStyle: true,
    titleFont: { size: 12, weight: '600' },
    bodyFont: { size: 12 },
    callbacks: formatValue
      ? {
          label: (ctx) => {
            const name = ctx.dataset.label ? `${ctx.dataset.label}: ` : ''
            return ` ${name}${formatValue(ctx.parsed.y ?? ctx.parsed)}`
          },
        }
      : undefined,
  }
}

/** The category axis: a hairline baseline, no rules running through the plot. */
function categoryAxis(t) {
  return {
    border: { color: t.axis },
    ticks: { color: t.ink2, font: { size: 11 }, padding: 6 },
    grid: { display: false },
  }
}

/** The value axis, hidden entirely when direct labels already carry the number. */
function valueAxis(t, { max, percent, hidden } = {}) {
  if (hidden) {
    return {
      display: false,
      beginAtZero: true,
      max,
      // Headroom so a label above the tallest bar is not clipped.
      grace: '12%',
    }
  }
  return {
    beginAtZero: true,
    max,
    border: { display: false },
    ticks: {
      color: t.ink3,
      font: { size: 11 },
      padding: 6,
      maxTicksLimit: 6,
      callback: percent ? (v) => `${v}%` : (v) => axisNumber(v),
    },
    grid: { color: t.grid, drawTicks: false, lineWidth: 1 },
  }
}

/**
 * Vertical bars.
 * Labelled by default, in which case the value axis is dropped as redundant.
 */
export function barOptions(
  tokens,
  { showLegend = false, percent = false, max, format, labelFormat, labels = true } = {}
) {
  const t = tokensOr(tokens)
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 8 } },
    plugins: {
      legend: legend(t, showLegend),
      tooltip: tooltip(t, format),
      valueLabels: labels
        ? { mode: 'bar', formatter: labelFormat || format, color: t.ink2 }
        : { display: false },
    },
    scales: {
      x: categoryAxis(t),
      y: valueAxis(t, { max, percent, hidden: labels }),
    },
    interaction: { mode: 'index', intersect: false },
  }
}

export function horizontalBarOptions(tokens, { format, labelFormat, labels = true } = {}) {
  const t = tokensOr(tokens)
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    layout: { padding: { right: 48 } },
    plugins: {
      legend: { display: false },
      tooltip: tooltip(t, format),
      valueLabels: labels
        ? { mode: 'hbar', formatter: labelFormat || format, color: t.ink2 }
        : { display: false },
    },
    scales: {
      y: categoryAxis(t),
      x: valueAxis(t, { percent: true, hidden: labels }),
    },
    interaction: { mode: 'nearest', intersect: true },
  }
}

/** Stacked percentage bars; segments separated by a 2px surface gap. */
export function stackedPercentOptions(tokens, { format } = {}) {
  const t = tokensOr(tokens)
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: legend(t, true),
      tooltip: tooltip(t, format),
      valueLabels: { mode: 'stack', formatter: format },
    },
    scales: {
      x: { ...categoryAxis(t), stacked: true },
      y: { display: false, stacked: true, max: 100, beginAtZero: true },
    },
    interaction: { mode: 'index', intersect: false },
  }
}

/**
 * Lines keep a light horizontal grid — intermediate points have to be read off
 * the axis — and label only each series' final value.
 */
export function lineOptions(tokens, { format, labelFormat } = {}) {
  const t = tokensOr(tokens)
  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 16, right: 12 } },
    plugins: {
      legend: legend(t, true),
      tooltip: tooltip(t, format),
      valueLabels: { mode: 'line-end', formatter: labelFormat || format },
    },
    scales: {
      x: categoryAxis(t),
      y: valueAxis(t),
    },
    interaction: { mode: 'index', intersect: false },
    elements: {
      line: { borderWidth: 2, tension: 0.25 },
      point: { radius: 4, hoverRadius: 6, hitRadius: 12, borderWidth: 2 },
    },
  }
}

export function doughnutOptions(tokens, { format, labelFormat } = {}) {
  const t = tokensOr(tokens)
  const base = legend(t, true)
  return {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    plugins: {
      legend: {
        ...base,
        position: 'right',
        align: 'center',
        labels: { ...base.labels, padding: 12 },
      },
      tooltip: tooltip(t, format),
      valueLabels: labelFormat
        ? { mode: 'arc', formatter: labelFormat }
        : { display: false },
    },
  }
}

/** 2px surface ring so adjacent arcs/segments read as separate marks. */
export function segmentGap(tokens) {
  const t = tokensOr(tokens)
  return { borderColor: t.surface, borderWidth: 2 }
}

// Native PowerPoint charts (DrawingML c:chartSpace parts) for generated slides.
// Data is embedded as literals (c:strLit / c:numLit) rather than a linked
// workbook, so charts render and restyle natively in PowerPoint without an
// embedded .xlsx; "Edit Data" is the only thing that isn't available.
// Element order inside every c:* node follows the OOXML schema sequence —
// PowerPoint "repairs" (drops) charts whose children are out of order.

export type ChartKind = "bar" | "column" | "stackedBar" | "stackedColumn" | "line" | "doughnut";

export interface ChartSeries {
  name: string;
  values: number[];
  color: string;
}

export interface ChartSpec {
  kind: ChartKind;
  categories: string[];
  series: ChartSeries[];
  /** doughnut only: one color per category (fixed order, never cycled). */
  pointColors?: string[];
  /** Excel number format for value labels / axis, e.g. "#,##0", "$#,##0", "0%". */
  numberFormat?: string;
  showValues?: boolean;
  showLegend?: boolean;
}

const INK = "4B5563";
const MUTED = "898781";
const GRID = "E1E0D9";
const AXIS = "C3C2B7";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function txPr(sz: number, color: string, bold = false): string {
  return (
    `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}"${bold ? ' b="1"' : ""}>` +
    `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Aptos"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`
  );
}

function solid(color: string): string {
  return `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr>`;
}

function strLit(values: string[]): string {
  return `<c:strLit><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join("")}</c:strLit>`;
}

function numLit(values: number[], format: string): string {
  return (
    `<c:numLit><c:formatCode>${esc(format)}</c:formatCode><c:ptCount val="${values.length}"/>` +
    values.map((v, i) => `<c:pt idx="${i}"><c:v>${Number.isFinite(v) ? v : 0}</c:v></c:pt>`).join("") +
    `</c:numLit>`
  );
}

function dLbls(format: string, position: string | null, show: boolean): string {
  if (!show) return `<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`;
  return (
    `<c:dLbls><c:numFmt formatCode="${esc(format)}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(800, INK)}` +
    (position ? `<c:dLblPos val="${position}"/>` : "") +
    `<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`
  );
}

/** Whole-number series with a small max get a step of 1, so the axis doesn't repeat rounded labels (0, 0, 1, 1…). */
function integerStep(spec: ChartSpec, format: string): number | null {
  if (format.includes(".")) return null;
  const values = spec.series.flatMap((s) => s.values);
  const stackedMax = Math.max(0, ...spec.categories.map((_, i) => spec.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)));
  const max = spec.kind === "stackedBar" || spec.kind === "stackedColumn" ? stackedMax : Math.max(0, ...values);
  return values.every((v) => Number.isInteger(v)) && max <= 8 ? 1 : null;
}

function axes(horizontal: boolean, format: string, majorUnit: number | null = null): string {
  const catPos = horizontal ? "l" : "b";
  const valPos = horizontal ? "b" : "l";
  // Horizontal bars list the first category at the top (maxMin), matching ranked reading order.
  return (
    `<c:catAx><c:axId val="1001"/><c:scaling><c:orientation val="${horizontal ? "maxMin" : "minMax"}"/></c:scaling><c:delete val="0"/>` +
    `<c:axPos val="${catPos}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/>` +
    `<c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="${AXIS}"/></a:solidFill></a:ln></c:spPr>${txPr(800, INK)}` +
    `<c:crossAx val="1002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="1002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${horizontal ? 1 : 0}"/>` +
    `<c:axPos val="${valPos}"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="${GRID}"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>` +
    `<c:numFmt formatCode="${esc(format)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txPr(800, MUTED)}<c:crossAx val="1001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/>` +
    (majorUnit ? `<c:majorUnit val="${majorUnit}"/>` : "") +
    `</c:valAx>`
  );
}

function plot(spec: ChartSpec): string {
  const format = spec.numberFormat ?? "#,##0";
  const show = spec.showValues ?? true;
  const cat = `<c:cat>${strLit(spec.categories)}</c:cat>`;

  if (spec.kind === "doughnut") {
    const s = spec.series[0];
    const colors = spec.pointColors ?? [];
    const dPts = spec.categories
      .map((_, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/>${solid(colors[i] ?? s.color)}</c:dPt>`)
      .join("");
    return (
      `<c:doughnutChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>` +
      `${dPts}${dLbls(format, null, show)}${cat}<c:val>${numLit(s.values, format)}</c:val></c:ser>` +
      `<c:firstSliceAng val="0"/><c:holeSize val="62"/></c:doughnutChart>`
    );
  }

  if (spec.kind === "line") {
    const sers = spec.series
      .map(
        (s, i) =>
          `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>` +
          `<c:spPr><a:ln w="25400" cap="rnd"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:round/></a:ln></c:spPr>` +
          `<c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>` +
          `${dLbls(format, "t", show)}${cat}<c:val>${numLit(s.values, format)}</c:val><c:smooth val="0"/></c:ser>`
      )
      .join("");
    return `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}<c:marker val="1"/><c:axId val="1001"/><c:axId val="1002"/></c:lineChart>${axes(false, format, integerStep(spec, format))}`;
  }

  const horizontal = spec.kind === "bar" || spec.kind === "stackedBar";
  const stacked = spec.kind === "stackedBar" || spec.kind === "stackedColumn";
  const sers = spec.series
    .map(
      (s, i) =>
        `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>${solid(s.color)}<c:invertIfNegative val="0"/>` +
        `${dLbls(format, stacked ? "ctr" : "outEnd", show)}${cat}<c:val>${numLit(s.values, format)}</c:val></c:ser>`
    )
    .join("");
  return (
    `<c:barChart><c:barDir val="${horizontal ? "bar" : "col"}"/><c:grouping val="${stacked ? "stacked" : "clustered"}"/><c:varyColors val="0"/>` +
    `${sers}<c:gapWidth val="${horizontal ? 45 : 60}"/>${stacked ? '<c:overlap val="100"/>' : spec.series.length > 1 ? '<c:overlap val="-10"/>' : ""}` +
    `<c:axId val="1001"/><c:axId val="1002"/></c:barChart>${axes(horizontal, format, integerStep(spec, format))}`
  );
}

export function buildChartXml(spec: ChartSpec): string {
  const legend =
    (spec.showLegend ?? (spec.kind === "doughnut" || spec.series.length > 1))
      ? `<c:legend><c:legendPos val="${spec.kind === "doughnut" ? "r" : "t"}"/><c:overlay val="0"/>${txPr(800, INK)}</c:legend>`
      : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>${plot(spec)}` +
    `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(800, INK)}</c:chartSpace>`
  );
}

export function chartFrameXml(id: number, rId: string, x: number, y: number, cx: number, cy: number): string {
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
    `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rId}"/>` +
    `</a:graphicData></a:graphic></p:graphicFrame>`
  );
}

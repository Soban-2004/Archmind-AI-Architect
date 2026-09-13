import { getNodesBounds, getViewportForBounds, type Node } from "@xyflow/react";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

// A diagram export should show the whole graph at a fixed, generous
// resolution regardless of the current on-screen zoom/pan — capturing
// the live viewport as-is would export whatever crop happens to be
// visible, which is not what "export the diagram" means.
const EXPORT_PADDING = 0.12;
const MIN_DIMENSION = 800;
const MAX_DIMENSION = 4000; // safety cap so a huge diagram doesn't produce an unreasonably large image

export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "architecture";
}

function download(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.download = filename;
  a.href = dataUrl;
  a.click();
}

async function captureDataUrl(nodes: Node[], flowElement: HTMLElement, backgroundColor: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const viewportEl = flowElement.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewportEl || nodes.length === 0) throw new Error("Nothing to export yet.");

  const bounds = getNodesBounds(nodes);
  const width = Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.round(bounds.width + 240)));
  const height = Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.round(bounds.height + 240)));
  const viewport = getViewportForBounds(bounds, width, height, 0.1, 2, EXPORT_PADDING);

  const dataUrl = await toPng(viewportEl, {
    backgroundColor,
    width,
    height,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
  });
  return { dataUrl, width, height };
}

export async function exportDiagramAsPng(nodes: Node[], flowElement: HTMLElement, projectName: string, dark: boolean): Promise<void> {
  const { dataUrl } = await captureDataUrl(nodes, flowElement, dark ? "#0f172a" : "#ffffff");
  download(dataUrl, `${slugify(projectName)}-architecture.png`);
}

export async function exportDiagramAsPdf(nodes: Node[], flowElement: HTMLElement, projectName: string, dark: boolean): Promise<void> {
  const { dataUrl, width, height } = await captureDataUrl(nodes, flowElement, dark ? "#0f172a" : "#ffffff");
  // A single page sized exactly to the image, in px units -- simpler and
  // more faithful than fitting into a fixed A4/Letter page, since this is
  // a diagram export, not a printable document.
  const pdf = new jsPDF({ orientation: width >= height ? "landscape" : "portrait", unit: "px", format: [width, height] });
  pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
  pdf.save(`${slugify(projectName)}-architecture.pdf`);
}

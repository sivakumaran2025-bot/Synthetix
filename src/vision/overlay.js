// Layer 2b: draw the "Set-of-Mark" overlay - numbered coloured boxes on top of the screenshot.
// We let the browser itself draw it (HTML/CSS), so there are no native image libraries to install.
import { config } from '../../config/env.js';

const colour = (id) => `hsl(${(id * 47) % 360} 85% 42%)`;

export async function renderSetOfMark(context, screenshotBuffer, boxes, viewport = config.viewport) {
  const page = await context.newPage();
  try {
    const src = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;
    const boxHtml = boxes.map((b) => {
      const c = colour(b.id);
      const tagClass = b.y >= 20 ? 'above' : 'inside';
      return `<div class="som-box" data-id="${b.id}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border-color:${c}">` +
             `<span class="som-tag ${tagClass}" style="background:${c}">${b.id}</span></div>`;
    }).join('');
    await page.setContent(`<!DOCTYPE html><html><head><style>
      html,body{margin:0;padding:0;background:#fff}
      #stage{position:relative;width:${viewport.width}px;height:${viewport.height}px;overflow:hidden}
      #shot{position:absolute;left:0;top:0;width:${viewport.width}px;height:${viewport.height}px}
      .som-box{position:absolute;border:2px solid;box-sizing:border-box;background:rgba(255,255,255,0.06)}
      .som-tag{position:absolute;left:-2px;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;
        color:#fff;font:700 13px/18px Arial,Helvetica,sans-serif;text-align:center}
      .som-tag.above{top:-20px} .som-tag.inside{top:-2px}
    </style></head><body><div id="stage"><img id="shot" src="${src}">${boxHtml}</div></body></html>`);
    await page.evaluate(() => document.getElementById('shot').decode());

    const drawn = await page.locator('.som-box').count();
    if (drawn !== boxes.length) throw new Error(`Overlay drew ${drawn} boxes, expected ${boxes.length}`);

    return await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: viewport.width, height: viewport.height } });
  } finally {
    await page.close();
  }
}

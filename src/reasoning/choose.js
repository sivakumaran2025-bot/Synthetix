// Layer 3: "given this goal and this numbered screenshot, which box do I use?"
// Muse sees ONLY the picture and the box list. It never sees the page's HTML.
import { config } from '../../config/env.js';
import { askMuse } from './muse.js';

export const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['click', 'fill', 'not_found'] },
    box_id: { type: ['integer', 'null'] },
    text: { type: ['string', 'null'] },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['action', 'box_id', 'text', 'confidence', 'reason'],
  additionalProperties: false,
};

export function buildPrompt({ goal, boxes, history = [], viewport = config.viewport }) {
  const list = boxes
    .map((b) => `${b.id}: ${b.label ?? 'element'} at x=${b.x}, y=${b.y}, size ${b.w}x${b.h}`)
    .join('\n');
  const past = history.length ? `Steps already done:\n${history.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\n` : '';
  return `You are controlling a web browser by looking at a screenshot (${viewport.width}x${viewport.height}). ` +
    `Every element you may use has a numbered box drawn on it.\n\n` +
    `GOAL FOR THIS STEP: ${goal}\n\n` +
    `Numbered elements:\n${list}\n\n${past}` +
    `Rules:\n` +
    `- Choose exactly ONE numbered box for this goal, judging by what you SEE: button text, product names, field labels, position.\n` +
    `- Several boxes can look identical (for example many "Add to cart" buttons). Use the surrounding text to tell them apart.\n` +
    `- Use action "click" for buttons and links. Use action "fill" for text boxes and put the exact text to type in "text".\n` +
    `- If no numbered box fits the goal, use action "not_found" with box_id null. Never guess.\n` +
    `- Give a one-sentence reason and a confidence from 0 to 1.\n` +
    `Reply with JSON only.`;
}

export function validateDecision(raw, boxes) {
  const action = raw?.action;
  if (!['click', 'fill', 'not_found'].includes(action)) throw new Error(`Muse returned an unknown action: ${JSON.stringify(action)}`);
  const confidence = Math.min(1, Math.max(0, Number(raw.confidence) || 0));
  const reason = String(raw.reason ?? '');
  if (action === 'not_found') return { action, box: null, text: null, confidence, reason };
  const box = boxes.find((b) => b.id === raw.box_id);
  if (!box) throw new Error(`Muse chose box ${JSON.stringify(raw.box_id)}, which is not on the screen (valid ids: ${boxes.map((b) => b.id).join(', ')})`);
  if (action === 'fill' && (typeof raw.text !== 'string' || raw.text === '')) throw new Error('Muse chose "fill" but gave no text to type');
  return { action, box, text: action === 'fill' ? raw.text : null, confidence, reason };
}

export async function chooseElement({ goal, boxes, overlay, history = [], muse = config.muse, viewport = config.viewport }) {
  if (!boxes.length) return { action: 'not_found', box: null, text: null, confidence: 0, reason: 'No elements were detected on the screen.' };
  const { json, ms } = await askMuse({
    prompt: buildPrompt({ goal, boxes, history, viewport }),
    imageBuffer: overlay,
    schema: ACTION_SCHEMA,
    schemaName: 'next_action',
    muse,
  });
  return { ...validateDecision(json, boxes), ms };
}

export interface Recipe { source: string; at: number; upscale: 'none' | 'anime4k' }
export interface Outline { width: number; color: string }
export interface CommonLayer { id: string; x: number; y: number; rotation: number; opacity: number; hidden: boolean; locked: boolean; slot?: 'frame' | 'face' | 'title' | 'subtitle' }
export interface ImageLayer extends CommonLayer { type: 'image'; src?: string; recipe?: Recipe; scale: number; fit: 'free' | 'cover'; flipX: boolean; outline?: Outline; shadow?: { blur: number; x: number; y: number; color: string }; filter: { blur: number; brightness: number } }
export interface TextLayer extends CommonLayer { type: 'text'; text: string; font: string; weight: number; size: number; color: string; emphasisColor: string; outlines: Outline[]; lineHeight: number; letterSpacing: number; align: 'left' | 'center' | 'right' }
export interface RectLayer extends CommonLayer { type: 'rect'; w: number; h: number; radius: number; fill: string | { type: 'linear'; from: string; to: string; angle: number } }
export type Layer = ImageLayer | TextLayer | RectLayer;
export interface Project { version: 1; size: { width: number; height: number }; layers: Layer[] }
export const THUMBNAIL_SIZE: { width: number; height: number };
export const FONT_WEIGHTS: Record<string, number[]>;
export function parseAssetRef(value: unknown): { type: 'frame' | 'image' | 'face'; id: string } | null;
export function normalizeRecipe(value: unknown): Recipe;
export function normalizeProject(value: unknown, options?: { template?: boolean }): Project;
export function applyTemplate(template: unknown, slots?: { frame?: string | { src: string; recipe: Recipe }; face?: string; title?: string; subtitle?: string }): Project;

export type CameraAspect = '9:16' | '16:9' | '1:1';
export interface CameraFrame { t: number; x: number; y: number; zoom: number; ease?: 'smooth' | 'linear' | 'cut' }
export interface CameraSource { width: number; height: number }
export interface CameraRect { x: number; y: number; w: number; h: number }
export type CameraExpr = number | 't' | { name: string; args: CameraExpr[] };
export const CAMERA_ASPECTS: CameraAspect[];
export function normalizeCamera(value: unknown): { keyframes: CameraFrame[]; error?: never } | { error: string; keyframes?: never };
export function aspectKey(size: CameraSource): CameraAspect | null;
export function baseRect(source: CameraSource, aspect: CameraAspect): { w: number; h: number };
export function cameraFrameAt(keyframes: CameraFrame[], t: number): CameraFrame;
export function cameraRectAt(keyframes: CameraFrame[], t: number, source: CameraSource, aspect: CameraAspect): CameraRect;
export function cameraExprAst(keyframes: CameraFrame[], source: CameraSource, aspect: CameraAspect): Record<keyof CameraRect, CameraExpr>;
export function exprToString(expr: CameraExpr): string;
export function evalExpr(expr: CameraExpr, t: number): number;
export function shiftCamera(keyframes: CameraFrame[], deltaSec: number, duration: number): CameraFrame[];

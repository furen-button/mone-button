export type HandlerRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  // rawBody の経路だけ。本文を読まずに渡すリクエストのストリーム。
  stream?: import('node:stream').Readable;
  headers: Record<string, string | string[] | undefined>;
  signal: AbortSignal;
};

export type HandlerResult =
  | { status: number; headers?: Record<string, string>; json: unknown }
  | {
      status: number;
      headers: Record<string, string>;
      stream: import('node:stream').Readable;
      length?: number;
    }
  | {
      status: 200;
      sse: {
        subscribe(emit: (event: string, data: unknown, id?: number) => void, since: number): () => void;
      };
    };

export type Route = {
  method: 'GET' | 'POST' | 'HEAD';
  pattern: RegExp;
  // true なら JSON を解析せず、video/* と application/octet-stream の本文を stream で受ける。配列ならその Content-Type（前方一致）だけを受ける。
  rawBody?: boolean | readonly string[];
  handler: (req: HandlerRequest, params: Record<string, string>) => Promise<HandlerResult>;
};

export type HandlerContext = {
  projectRoot: string;
  presetsDir: string;
  outputDir: string;
  cacheDir: string;
  schemaPath: string;
};

export function createHandlers(context?: Partial<HandlerContext>): Route[];
export function matchRoute(
  routes: Route[],
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | null;

// dev 限定: vite-plugin-data-editor の削除エンドポイントを叩き、json と mp4 を trash/ へ退避する。
// 呼び出し側は import.meta.env.DEV でガードする前提。
export async function deleteClipData(fileBaseName: string): Promise<void> {
  const response = await fetch('/__data/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileBaseName }),
  })

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(detail?.error ?? `削除に失敗しました (${response.status})`)
  }
}

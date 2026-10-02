export function withVideoCacheBust(videoPath: string, version?: number): string {
  if (!version) {
    return videoPath
  }

  const hashIndex = videoPath.indexOf('#')
  const beforeHash = hashIndex >= 0 ? videoPath.slice(0, hashIndex) : videoPath
  const hash = hashIndex >= 0 ? videoPath.slice(hashIndex) : ''
  const queryIndex = beforeHash.indexOf('?')
  const pathPart = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : ''
  const params = new URLSearchParams(query)
  params.set('trimv', String(version))
  return `${pathPart}?${params.toString()}${hash}`
}

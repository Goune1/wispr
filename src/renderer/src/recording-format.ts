export interface RecordingFormat {
  mimeType: string
  extension: '.m4a' | '.webm' | '.ogg'
}

/** Uses MP4/AAC first on macOS-capable Chromium, then portable WebM/Ogg fallbacks. */
export function selectRecordingFormat(isSupported: (mimeType: string) => boolean): RecordingFormat | null {
  const formats: RecordingFormat[] = [
    { mimeType: 'audio/mp4;codecs=mp4a.40.2', extension: '.m4a' },
    { mimeType: 'audio/mp4', extension: '.m4a' },
    { mimeType: 'audio/webm;codecs=opus', extension: '.webm' },
    { mimeType: 'audio/webm', extension: '.webm' },
    { mimeType: 'audio/ogg;codecs=opus', extension: '.ogg' }
  ]
  return formats.find((format) => isSupported(format.mimeType)) ?? null
}

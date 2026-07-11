interface ClipboardLike {
  writeText(text: string): Promise<void>
}

export class BrowserClipboard {
  constructor(private readonly clipboard: ClipboardLike = navigator.clipboard) {}

  async copy(text: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.clipboard.writeText(text)
      return { ok: true }
    } catch {
      return { ok: false, error: "클립보드에 복사하지 못했어요." }
    }
  }
}

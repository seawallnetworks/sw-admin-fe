// The help drawer's text: sections of public/llms.txt, the user manual written for AI assistants.
// One file for both, so the help a person reads and the help an assistant reads can't drift apart.

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; text: string }
  /** A list item; `level` 1 is nested under the item before it (the manual nests one level at most). */
  | { kind: 'item'; level: number; marker: string; text: string }

export interface Section {
  title: string
  blocks: Block[]
}

let manual: Promise<Section[]> | null = null

/** Fetches and parses the manual, once; a failed fetch is tried again on the next call. */
export function loadManual(): Promise<Section[]> {
  manual ??= fetch('/llms.txt')
    .then((res) => {
      if (!res.ok) throw new Error(`manual: ${res.status}`)
      return res.text()
    })
    .then(parseManual)
    .catch((e) => {
      manual = null
      throw e
    })
  return manual
}

/** Splits the manual at its "## " headings. The title and summary above the first one are for assistants only. */
export function parseManual(text: string): Section[] {
  const sections: Section[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      sections.push({ title: line.slice(3).trim(), blocks: [] })
      continue
    }
    const section = sections.at(-1)
    if (!section || !line.trim()) continue
    const item = /^( *)(-|\d+\.) (.*)$/.exec(line)
    if (line.startsWith('### ')) {
      section.blocks.push({ kind: 'heading', text: line.slice(4).trim() })
    } else if (item) {
      section.blocks.push({ kind: 'item', level: item[1] ? 1 : 0, marker: item[2] === '-' ? '•' : item[2], text: item[3] })
    } else {
      section.blocks.push({ kind: 'para', text: line.trim() })
    }
  }
  return sections
}

/** Splits a line at its `code` spans: the odd-numbered parts are code. */
export const inlineParts = (text: string) => text.split('`')

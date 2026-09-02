type StyleObject = {
    styleUrl: string,
    match: string,
}

const regex = /styleUrl\s*:\s*(['"])(.*?)\1/

export function obtainStyleUrl(code: string): StyleObject | undefined {
  if (!code.includes("styleUrl")) return

  const match = code.match(regex)
  if (!match) return

  const [fullMatch,,styleUrl] = match
  if (styleUrl === undefined) return

  return { styleUrl, match: fullMatch }
}

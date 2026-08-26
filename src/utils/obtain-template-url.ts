type TemplateObject = {
    templateUrl: string
}

const regex = /templateUrl\s*:\s*(['"])(.*?)\1/

export function obtainTemplateUrl(code: string): TemplateObject | undefined {
  if (!code.includes("templateUrl")) return

  const match = code.match(regex)
  if (!match) return

  const [,,templateUrl] = match
  if (templateUrl === undefined) return

  return { templateUrl }
}
import { createHash } from "node:crypto";
import { type DefaultTreeAdapterMap, parseFragment, serialize } from "parse5";
import * as csstree from "css-tree";
import { FileReader, type FileReaderReadOptions } from "@ng-js-vite/reading/file-resolver.ts";

type Node = DefaultTreeAdapterMap["childNode"]
type Element = DefaultTreeAdapterMap["element"]

const KEYFRAMES_AT_RULE = /^(-webkit-|-moz-)?keyframes$/i
const NESTED_SELECTOR_PSEUDO_CLASS = /^(not|is|where|has)$/i

function isElement(node: Node): node is Element {
    return "tagName" in node
}

export class TemplatePatcher {
    private constructor(
        public readonly scope: string,
        public readonly template: Buffer,
        public readonly style?: Buffer,
    ) {}

    private static _scopeTemplate(template: Buffer, scope: string): Buffer {
        const fragment = parseFragment(template.toString("utf-8"))

        const walk = (node: Node) => {
            if (isElement(node)) node.attrs.push({ name: scope, value: "" })
            if ("childNodes" in node) node.childNodes.forEach(walk)
        }

        fragment.childNodes.forEach(walk)

        return Buffer.from(serialize(fragment), "utf-8")
    }

    private static _scopeStyle(style: Buffer, scope: string): Buffer {
        const ast = csstree.parse(style.toString("utf-8"))

        csstree.walk(ast, {
            visit: "Rule",
            enter(rule) {
                const atruleName = this.atrule?.name
                if (atruleName && KEYFRAMES_AT_RULE.test(atruleName)) return
                if (rule.prelude?.type !== "SelectorList") return

                TemplatePatcher._scopeSelectorList(scope, rule.prelude)
            }
        })

        return Buffer.from(csstree.generate(ast), "utf-8")
    }

    private static _scopeSelectorList(scope: string, selectorList: csstree.SelectorList): void {
        selectorList.children.forEach(selector => TemplatePatcher._scopeSelector(scope, selector as csstree.Selector))
    }

    private static _scopeSelector(scope: string, selector: csstree.Selector): void {
        selector.children.forEach(child => {
            if (child.type !== "PseudoClassSelector" || !NESTED_SELECTOR_PSEUDO_CLASS.test(child.name) || !child.children) return

            child.children.forEach(argument => {
                if (argument.type === "SelectorList") TemplatePatcher._scopeSelectorList(scope, argument)
            })
        })

        const attribute: csstree.AttributeSelector = {
            type: "AttributeSelector",
            name: { type: "Identifier", name: scope },
            matcher: null,
            value: null,
            flags: null,
        }

        if (selector.children.last?.type === "PseudoElementSelector") {
            const pseudoElementItem = selector.children.pop()!
            selector.children.appendData(attribute)
            selector.children.append(pseudoElementItem)
        } else {
            selector.children.appendData(attribute)
        }
    }

    static async from(fileReader: FileReader, options: FileReaderReadOptions = {}): Promise<TemplatePatcher> {
        const { template, style } = await fileReader.read(options)
        const scope = TemplatePatcher._scope(fileReader.templatePath)

        return new TemplatePatcher(
            scope,
            TemplatePatcher._scopeTemplate(template, scope),
            style ? TemplatePatcher._scopeStyle(style, scope) : undefined,
        )
    }

    private static _scope(templatePath: string): string {
        const hash = createHash("sha256")
        const hashStr = hash.update(templatePath).digest("hex").slice(0, 8)

        return `_content-${hashStr}`
    }
}

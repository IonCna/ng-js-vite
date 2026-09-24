import { createHash } from "node:crypto";
import { type DefaultTreeAdapterMap, parseFragment, serialize } from "parse5";
import * as csstree from "css-tree";
import { FileReader, type FileReaderReadOptions } from "@ng-js-vite/reading/file-resolver.ts";
import { HostSelector } from "@ng-js-vite/writing/host-selector.ts";

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

    private static _scopeStyle(style: Buffer, scope: string, host: HostSelector | undefined): Buffer {
        const ast = csstree.parse(style.toString("utf-8"))

        csstree.walk(ast, {
            visit: "Rule",
            enter(rule) {
                const atruleName = this.atrule?.name
                if (atruleName && KEYFRAMES_AT_RULE.test(atruleName)) return
                if (rule.prelude?.type !== "SelectorList") return

                TemplatePatcher._scopeSelectorList(scope, host, rule.prelude)
            }
        })

        return Buffer.from(csstree.generate(ast), "utf-8")
    }

    /** Cada selector: `:host*` → el selector del componente (puede dar dos, `:host-context`), después el scope. */
    private static _scopeSelectorList(scope: string, host: HostSelector | undefined, selectorList: csstree.SelectorList): void {
        const selectors = selectorList.children.toArray().flatMap(node => {
            const selector = node as csstree.Selector
            const variants = host ? host.expand(selector) : [{ nodes: selector.children.toArray(), targetsHost: false }]
            return variants.map(({ nodes, targetsHost }) => {
                const scoped: csstree.Selector = { type: "Selector", children: new csstree.List<csstree.CssNode>().fromArray(nodes) }
                TemplatePatcher._scopeSelector(scope, host, scoped, targetsHost)
                return scoped as csstree.CssNode
            })
        })
        selectorList.children = new csstree.List<csstree.CssNode>().fromArray(selectors)
    }

    /** El atributo de contenido va en el último compuesto — salvo que ese sea el host (no es parte del template). */
    private static _scopeSelector(scope: string, host: HostSelector | undefined, selector: csstree.Selector, targetsHost: boolean): void {
        selector.children.forEach(child => {
            if (child.type !== "PseudoClassSelector" || !NESTED_SELECTOR_PSEUDO_CLASS.test(child.name) || !child.children) return
            if (HostSelector.isHostNode(child)) return

            child.children.forEach(argument => {
                if (argument.type === "SelectorList") TemplatePatcher._scopeSelectorList(scope, host, argument)
            })
        })
        if (targetsHost) return

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
            style ? TemplatePatcher._scopeStyle(style, scope, HostSelector.from(fileReader.hostSelector)) : undefined,
        )
    }

    private static _scope(templatePath: string): string {
        const hash = createHash("sha256")
        const hashStr = hash.update(templatePath).digest("hex").slice(0, 8)

        return `_content-${hashStr}`
    }
}

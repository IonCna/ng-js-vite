import * as csstree from "css-tree"

/** Marca de los nodos que vinieron del selector del host (ver `HostSelector.isHostNode`). */
const HOST_MARK = Symbol("ngjs.host")

/** Un selector ya traducido: sus nodos y si el último compuesto es el host (ese no lleva el atributo de contenido). */
export type ExpandedSelector = {
    nodes: csstree.CssNode[]
    targetsHost: boolean
}

/**
 * `:host`, `:host(...)` y `:host-context(...)` del CSS de un componente → su propio `selector` (`app-card`). Un
 * `@Component` acá siempre tiene selector de elemento, así que el host se identifica por él solo — sin atributo
 * `_nghost` que alguien tenga que poner en runtime (a diferencia de Angular; la especificidad es la del tag).
 *
 * - `:host` → `app-card`; con coma (`app-a, app-b`) → `:is(app-a, app-b)`.
 * - `:host(.active)` → `app-card.active`.
 * - `:host-context(.dark) p` → `.dark app-card p` y `app-card.dark p` (ancestro o el host mismo, como Angular).
 */
export class HostSelector {
    private constructor(private readonly host: csstree.CssNode[]) {}

    static from(selector: string | undefined): HostSelector | undefined {
        const trimmed = selector?.trim()
        if (!trimmed) return undefined
        const source = trimmed.includes(",") ? `:is(${trimmed})` : trimmed
        const parsed = csstree.parse(source, { context: "selector" }) as csstree.Selector
        return new HostSelector(parsed.children.toArray())
    }

    /** Sin `:host*` devuelve el selector tal cual (una sola variante); `:host-context` produce dos. */
    expand(selector: csstree.Selector): ExpandedSelector[] {
        return this.expandNodes(selector.children.toArray()).map(nodes => ({
            nodes,
            targetsHost: HostSelector.lastCompound(nodes).some(node => HostSelector.isHostNode(node)),
        }))
    }

    private expandNodes(nodes: csstree.CssNode[]): csstree.CssNode[][] {
        const index = nodes.findIndex(node => HostSelector.isPseudo(node, "host") || HostSelector.isPseudo(node, "host-context"))
        if (index === -1) return [nodes]

        const node = nodes[index] as csstree.PseudoClassSelector
        const before = nodes.slice(0, index)
        const argument = HostSelector.argument(node)
        const variants = node.name.toLowerCase() === "host"
            ? [[...this.hostNodes(), ...argument]]
            : [
                [...argument, { type: "Combinator", name: " " } as csstree.Combinator, ...this.hostNodes()],
                [...this.hostNodes(), ...argument],
            ]

        return this.expandNodes(nodes.slice(index + 1)).flatMap(rest => variants.map(variant => [...before, ...variant, ...rest]))
    }

    /**
     * Un nodo que vino del selector del host: no es parte del template, así que no lleva el atributo de contenido
     * (ni adentro de su `:is(...)`). La marca es una clave `Symbol`, que `csstree.generate` no ve.
     */
    static isHostNode(node: csstree.CssNode): boolean {
        return (node as unknown as Record<symbol, unknown>)[HOST_MARK] === true
    }

    /** Copias frescas del selector del host, marcadas (`isHostNode`). */
    private hostNodes(): csstree.CssNode[] {
        return this.host.map(node => ({ ...csstree.clone(node), [HOST_MARK]: true }) as unknown as csstree.CssNode)
    }

    /** `:host(.a)` / `:host-context(.a)` → los nodos de `.a` (css-tree los parsea como un `Selector`). */
    private static argument(node: csstree.PseudoClassSelector): csstree.CssNode[] {
        const selector = node.children?.first
        return selector?.type === "Selector" ? selector.children.toArray().map(child => csstree.clone(child)) : []
    }

    private static lastCompound(nodes: csstree.CssNode[]): csstree.CssNode[] {
        const lastCombinator = nodes.map(node => node.type).lastIndexOf("Combinator")
        return nodes.slice(lastCombinator + 1)
    }

    private static isPseudo(node: csstree.CssNode, name: string): boolean {
        return node.type === "PseudoClassSelector" && node.name.toLowerCase() === name
    }
}


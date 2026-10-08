/** Tiny DOM builder. No innerHTML anywhere (YouTube enforces Trusted Types). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<{ className: string; text: string; title: string; type: string; accept: string }> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  if (props.type) node.setAttribute('type', props.type);
  if (props.accept) node.setAttribute('accept', props.accept);
  for (const c of children) node.append(c);
  return node;
}

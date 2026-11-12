declare module "idiomorph" {
  export const Idiomorph: {
    morph(oldNode: Element, newContent: Element | string | Node[], config?: { morphStyle?: "innerHTML" | "outerHTML"; ignoreActive?: boolean }): unknown;
  };
}

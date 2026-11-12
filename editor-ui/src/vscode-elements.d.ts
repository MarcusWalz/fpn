// JSX typings for the VS Code Elements web components we use.
import "react";

type El = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "vscode-button": El;
      "vscode-textfield": El;
      "vscode-textarea": El;
      "vscode-single-select": El;
      "vscode-option": El;
      "vscode-checkbox": El;
      "vscode-tabs": El;
      "vscode-tab-header": El;
      "vscode-tab-panel": El;
      "vscode-badge": El;
      "vscode-icon": El;
      "vscode-progress-ring": El;
      "vscode-label": El;
      "vscode-divider": El;
    }
  }
}

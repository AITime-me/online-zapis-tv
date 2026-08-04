/**
 * Allow tsx/node to import CSS modules as empty side-effects
 * (Next.js handles real CSS; presentation checks only need JS).
 */
import Module from "node:module";

type ModuleWithExtensions = typeof Module & {
  _extensions: Record<string, (module: NodeModule, filename: string) => void>;
};

const extensions = (Module as ModuleWithExtensions)._extensions;
extensions[".css"] = (module) => {
  module.exports = {};
};

// The one place that names the worker file: Vite bundles it as a same-origin chunk (a `?worker` import), which is
// not loadable by the node tests, so alignClient.js takes this as a parameter.
import AlignWorker from "./audioAlign.worker.js?worker";

export const makeAlignWorker = () => new AlignWorker();

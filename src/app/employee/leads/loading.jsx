// Each route needs its OWN boundary. A parent loading.jsx does not
// re-trigger when only a sibling child segment changes. See
// src/app/employee/loading.jsx.
export { default } from "../loading";

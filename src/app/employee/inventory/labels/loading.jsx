// Each route needs its OWN boundary. A parent loading.jsx does not
// re-trigger when only a sibling child segment changes, which left the content
// area blank between commit and content. See src/app/employee/loading.jsx.
export { default } from "../../loading";

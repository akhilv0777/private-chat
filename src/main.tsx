import { createRoot } from "react-dom/client";
import App from "./App";
// Ignore missing type declarations for CSS side-effect import
// @ts-ignore
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

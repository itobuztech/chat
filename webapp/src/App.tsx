import { useState } from "react";
import reactLogo from "./assets/react.svg";
import "./App.css";

const backendBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

function App(): JSX.Element {
  const [count, setCount] = useState(0);

  return (
    <>
      <div>
        <a href="https://vitejs.dev" target="_blank" rel="noreferrer">
          <img src="/vite.svg" className="logo" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank" rel="noreferrer">
          <img src={reactLogo} className="logo react" alt="React logo" />
        </a>
      </div>
      <h1>P2P Chat Web</h1>
      <div className="card">
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          count is {count}
        </button>
        <p>
          Configure your backend API endpoint via <code>VITE_API_BASE_URL</code>.
        </p>
        <p>Current backend base URL: {backendBaseUrl}</p>
      </div>
      <p className="read-the-docs">Click on the logos to learn more.</p>
    </>
  );
}

export default App;

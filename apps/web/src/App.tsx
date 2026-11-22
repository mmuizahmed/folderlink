import { Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell.tsx";
import { Connect } from "./pages/Connect.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Landing } from "./pages/Landing.tsx";

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Landing />} />
        <Route path="/connect" element={<Connect />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Route>
    </Routes>
  );
}

import { Route, Routes } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Landing } from "./pages/Landing.tsx";
import { Privacy, Terms } from "./pages/Legal.tsx";
import { Pair } from "./pages/Pair.tsx";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/pair" element={<Pair />} />
      <Route path="/connect" element={<Pair />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
    </Routes>
  );
}

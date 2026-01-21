import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Master from "./pages/master";
import Player from "./pages/player";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/master" element={<Master />} />
        <Route path="/player" element={<Player />} />
      </Routes>
    </Router>
  );
}

export default App;

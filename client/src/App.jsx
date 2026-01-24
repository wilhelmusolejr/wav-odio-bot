import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Master from "./pages/master";
import Player from "./pages/player";
import Hidemium from "./pages/hidemium";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/master" element={<Master />} />
        <Route path="/player" element={<Player />} />
        <Route path="/hidemium/:botName" element={<Hidemium />} />
      </Routes>
    </Router>
  );
}

export default App;

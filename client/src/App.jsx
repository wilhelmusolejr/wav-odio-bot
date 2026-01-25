import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Master from "./pages/master";
import Player from "./pages/player";
import Hidemium from "./pages/hidemium";
import Bonk from "./pages/Bonk";
import Benk from "./pages/Benk";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Bonk />} />
        <Route path="/benk" element={<Benk />} />
        <Route path="/master" element={<Master />} />
        <Route path="/player" element={<Player />} />
        <Route path="/hidemium/:botName" element={<Hidemium />} />
      </Routes>
    </Router>
  );
}

export default App;

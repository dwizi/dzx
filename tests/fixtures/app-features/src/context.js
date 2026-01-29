export default function createContext(_req) {
  // Simulate extracting a user from headers
  return {
    user: "Carlos",
    role: "admin",
    timestamp: Date.now(),
  };
}

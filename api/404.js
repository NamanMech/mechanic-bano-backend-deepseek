// api/404.js
export default function handler(req, res) {
  res.status(404).json({ 
    error: 'API endpoint not found',
    message: 'Check the URL and try again'
  });
}

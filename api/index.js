// वैकल्पिक: मल्टीपल एंडपॉइंट्स के लिए
import generalHandler from './general.js';
import subscriptionHandler from './subscription.js';
import userHandler from './users.js';
import welcomeHandler from './welcome.js';

export default async function handler(req, res) {
  const path = req.url.split('/').pop();
  
  if (path === 'general') return generalHandler(req, res);
  if (path === 'subscription') return subscriptionHandler(req, res);
  if (path === 'users') return userHandler(req, res);
  if (path === 'welcome') return welcomeHandler(req, res);
  
  return res.status(404).json({ message: 'Endpoint not found' });
}

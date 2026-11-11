// On the static guide pages: saves a campaign link's utm_* parameters for the order page (src/lib/attribution.ts).
import { captureSource } from './lib/attribution';

captureSource(location.search);

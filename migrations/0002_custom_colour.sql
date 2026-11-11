-- A colour we don't stock: the buyer's description and previewed colour, for buying matching filament.
ALTER TABLE orders ADD COLUMN custom_colour TEXT;

-- More base distributions for appliance builds.
ALTER TABLE os_images DROP CONSTRAINT IF EXISTS os_images_family_check;
ALTER TABLE os_images
  ADD CONSTRAINT os_images_family_check
  CHECK (family IN ('debian', 'ubuntu', 'rocky', 'alpine'));

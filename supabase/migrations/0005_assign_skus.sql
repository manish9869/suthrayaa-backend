-- Assigns SKUs (format CR-[MAIN]-[SUB]-[NUMBER]) to the products seeded before the SKU
-- field existed, matching where 0004 re-homed them in the new taxonomy.

update products set sku = 'CR-KEY-NAME-001' where slug = 'personalized-name-keychain';
update products set sku = 'CR-KEY-INIT-001' where slug = 'initial-letter-keychain';
update products set sku = 'CR-TOY-BUN-001' where slug = 'cute-bunny-amigurumi';
update products set sku = 'CR-TOY-TED-001' where slug = 'teddy-bear-amigurumi';
update products set sku = 'CR-DEC-MAC-001' where slug = 'macrame-plant-hanger';
update products set sku = 'CR-DEC-BAS-001' where slug = 'crochet-basket-set';
update products set sku = 'CR-BABY-BOOT-001' where slug = 'baby-booties-set';
update products set sku = 'CR-COAST-DIW-001' where slug = 'diwali-diya-coasters';

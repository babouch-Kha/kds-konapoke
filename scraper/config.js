// ============================================================
// KDS Konapoke — Configuration
// ============================================================

module.exports = {
  // --- Zelty credentials ---
  zelty: {
    loginUrl: 'https://bo.zelty.fr/login',
    boardUrl: 'https://bo.zelty.fr/board#tickets',
    ticketBaseUrl: 'https://bo.zelty.fr/tickets',
    email: process.env.ZELTY_EMAIL || '',
    password: process.env.ZELTY_PASSWORD || '',
  },

  // --- Scraping intervals ---
  scraping: {
    // Interval between full scraping cycles (ms)
    pollInterval: 10_000,
    // Timeout for page navigation (ms)
    navigationTimeout: 30_000,
    // Timeout for waiting for selectors (ms)
    selectorTimeout: 15_000,
  },

  // --- Server ---
  server: {
    port: process.env.PORT || 3456,
    // CORS origins allowed (the KDS frontend)
    corsOrigins: ['*'],
  },

  // --- Cuisson keywords ---
  // Mots-clés pour identifier les éléments à lancer en cuisson.
  // Chaque entrée : { keyword, label, color }
  //   - keyword : recherche case-insensitive dans le nom du produit OU dans les options
  //   - label   : nom affiché sur le KDS
  //   - color   : couleur d'accent sur le KDS (hex)
  //   - type    : "product" = match sur le nom du produit, "option" = match dans les options, "both" = les deux
  cuissonKeywords: [
    // --- Produits "Roll" (match sur le nom du produit) ---
    { keyword: 'chicken roll',         label: 'Chicken Roll',        color: '#FF6B35', type: 'product' },
    { keyword: 'crispy roll',          label: 'Crispy Roll',         color: '#FF6B35', type: 'product' },
    { keyword: 'salmon roll',          label: 'Salmon Roll',         color: '#FF6B35', type: 'product' },
    { keyword: 'brioche au nutella',   label: 'Brioche Nutella',     color: '#FF6B35', type: 'product' },
    { keyword: 'ice cream roll',       label: 'Ice Cream Roll',      color: '#FF6B35', type: 'product' },
    { keyword: 'personnalise ton roll',label: 'Roll Perso',          color: '#FF6B35', type: 'product' },

    // --- Box directes (match sur le nom du produit) ---
    { keyword: 'box chicken tempura',  label: 'Box Chicken Tempura', color: '#E63946', type: 'product' },
    { keyword: 'box gyozas',           label: 'Box Gyozas',          color: '#457B9D', type: 'product' },
    { keyword: 'box tempura crevette', label: 'Box Tempura Crevette',color: '#E63946', type: 'product' },

    // --- Options à l'intérieur des produits ---
    { keyword: 'chicken tempura',      label: 'Chicken Tempura',     color: '#E63946', type: 'option' },
    { keyword: 'poulet tempura',       label: 'Poulet Tempura',      color: '#E63946', type: 'option' },
    { keyword: 'crevettes tempura',    label: 'Crevettes Tempura',   color: '#E63946', type: 'option' },
    { keyword: 'falafel',              label: 'Falafel',             color: '#2A9D8F', type: 'option' },
    { keyword: 'gyozas poulet',        label: 'Gyozas Poulet',       color: '#457B9D', type: 'option' },
    { keyword: 'gyozas légumes',       label: 'Gyozas Légumes',      color: '#457B9D', type: 'option' },
  ],
};

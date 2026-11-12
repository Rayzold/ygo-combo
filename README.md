# YGO Combo Helper

Web app για Yu-Gi-Oh! TCG: φόρτωσε το deck σου (.ydk ή αναζήτηση), τσέκαρε τις κάρτες που έχεις, και πάρε:

- σήματα και προειδοποιήσεις για Forbidden / Limited / Semi-Limited (banlist TCG),
- combos μόνο με τις κάρτες που έχεις (Gemini, με το δικό σου δωρεάν key από aistudio.google.com),
- προτάσεις για Extra Deck (ελεγμένες ότι υπάρχουν) και Side Deck (TCG staples).

Τα δεδομένα καρτών έρχονται από το YGOPRODeck API και κρατιούνται σε cache στον browser. Το Gemini key μένει μόνο στον browser σου.

```
npm install
npm run dev     # τοπικά
npm test        # vitest
npm run build   # στατικό site στο dist/
```

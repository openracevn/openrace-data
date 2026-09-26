import type { Site } from "../sites.ts";
import { actiupRecipe } from "./actiup.ts";
import { defaultRecipe } from "./default.ts";
import { iraceRecipe } from "./irace.ts";
import type { Recipe } from "./types.ts";
import { vnexpressMarathonRecipe } from "./vnexpress-marathon.ts";

export const RECIPES: Record<string, Recipe> = {
  default: defaultRecipe,
  actiup: actiupRecipe,
  "vnexpress-marathon": vnexpressMarathonRecipe,
  irace: iraceRecipe,
};

/** The recipe a site is read with, or null for sites only recognized in links (recipe: none). */
export function recipeFor(site: Site): Recipe | null {
  if (site.recipe === "none") return null;
  const recipe = RECIPES[site.recipe];
  if (!recipe) throw new Error(`site ${site.key}: unknown recipe "${site.recipe}" (known: ${Object.keys(RECIPES).join(", ")}, none)`);
  return recipe;
}

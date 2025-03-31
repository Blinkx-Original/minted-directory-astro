import { getCollection } from "astro:content";

export async function getRootPages(remapIndex: boolean = true) {
  const allListings = await getCollection("directory");
  const allPages = await getCollection("pages");

  // Combine listings and pages
  const combinedEntries = allListings.concat(allPages as never);

  // Return paths based on slugs
  return combinedEntries.map((entry) => {
    let mySlug: string = entry.id;

    if (mySlug === "index" && remapIndex) {
      mySlug = "/";
    }

    return {
      params: { slug: mySlug },
      props: { entry },
    };
  });
}

const search = document.querySelector("#directory-search");
const count = document.querySelector("#directory-count");
const categories = document.querySelector("#directory-categories");
const index = document.querySelector("#site-index");
let sites = [];
let activeCategory = "All";

function domainFor(site) {
  try { return new URL(site.profileUrl.replace("{}", "username")).hostname.replace(/^www\./, ""); }
  catch { return "Public profile"; }
}

function renderCategories() {
  const values = ["All", ...new Set(sites.map(site => site.category))];
  categories.replaceChildren(...values.map(value => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = value === activeCategory ? "active" : "";
    button.textContent = value;
    button.addEventListener("click", () => { activeCategory = value; renderCategories(); renderSites(); });
    return button;
  }));
}

function renderSites() {
  const query = search.value.trim().toLocaleLowerCase();
  const visible = sites.filter(site => {
    const categoryMatch = activeCategory === "All" || site.category === activeCategory;
    const haystack = `${site.name} ${site.category} ${site.region || ""} ${(site.tags || []).join(" ")} ${domainFor(site)}`.toLocaleLowerCase();
    return categoryMatch && (!query || haystack.includes(query));
  });
  count.textContent = `${visible.length} of ${sites.length}`;
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "directory-empty";
    empty.textContent = "No platforms match that search.";
    index.replaceChildren(empty);
    return;
  }
  index.replaceChildren(...visible.map(site => {
    const card = document.createElement("article");
    const title = document.createElement("h2");
    title.textContent = site.name;
    const domain = document.createElement("p");
    domain.textContent = domainFor(site);
    const category = document.createElement("span");
    category.textContent = site.region && site.region !== "Global" ? `${site.category} · ${site.region}` : site.category;
    card.append(title, domain, category);
    return card;
  }));
}

search.addEventListener("input", renderSites);

fetch("data/platforms.json", { cache: "no-cache" })
  .then(response => { if (!response.ok) throw new Error("Platform catalogue could not be loaded."); return response.json(); })
  .then(data => { sites = [...(data.sites || [])].sort((a, b) => a.name.localeCompare(b.name)); renderCategories(); renderSites(); })
  .catch(error => { count.textContent = "Unavailable"; index.textContent = error.message; });

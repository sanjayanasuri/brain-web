import re
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from neo4j import Session

def generate_slug(name: str) -> str:
    """Generate a URL-friendly slug from a concept name."""
    # Convert to lowercase
    slug = name.lower()
    # Replace spaces and underscores with hyphens
    slug = re.sub(r'[\s_]+', '-', slug)
    # Remove all non-alphanumeric characters except hyphens
    slug = re.sub(r'[^a-z0-9\-]', '', slug)
    # Replace multiple hyphens with single hyphen
    slug = re.sub(r'-+', '-', slug)
    # Remove leading/trailing hyphens
    slug = slug.strip('-')
    return slug

def ensure_unique_slug(session: "Session", base_slug: str, exclude_node_id: Optional[str] = None) -> str:
    """Ensure slug is unique by appending numbers if needed."""
    slug = base_slug
    counter = 1
    
    while True:
        query = "MATCH (c:Concept) WHERE c.url_slug = $slug"
        params = {"slug": slug}
        
        if exclude_node_id:
            query += " AND c.node_id <> $exclude_node_id"
            params["exclude_node_id"] = exclude_node_id
        
        query += " RETURN c LIMIT 1"
        
        result = session.run(query, params)
        if not result.single():
            return slug
        
        slug = f"{base_slug}-{counter}"
        counter += 1

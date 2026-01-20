"""
Geocoding service for location search.
Uses OpenStreetMap Nominatim API (free, no API key required).
Can be easily switched to Google Places API for production.
"""
import os
import requests
import logging
import math
from typing import List, Dict, Any, Optional
from urllib.parse import quote

logger = logging.getLogger("brain_web")


def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great circle distance between two points on Earth (in miles).
    Uses the Haversine formula.
    """
    R = 3959  # Earth's radius in miles
    
    # Convert to radians
    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)
    
    # Haversine formula
    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad
    
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    
    return R * c

# OpenStreetMap Nominatim API (free, no API key needed)
NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org/search"

# Google Places API (for production - requires API key)
GOOGLE_PLACES_API_KEY = os.getenv("GOOGLE_PLACES_API_KEY")
GOOGLE_PLACES_BASE_URL = "https://maps.googleapis.com/maps/api/place"


def search_locations_nominatim(
    query: str,
    limit: int = 10,
    current_lat: Optional[float] = None,
    current_lon: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """
    Search for locations using OpenStreetMap Nominatim API.
    
    Args:
        query: Search query (e.g., "West Lafayette Public Library")
        limit: Maximum number of results
        current_lat: Current latitude for distance calculation
        current_lon: Current longitude for distance calculation
    
    Returns:
        List of location results with name, address, coordinates, and distance
    """
    try:
        params = {
            "q": query,
            "format": "json",
            "limit": limit,
            "addressdetails": 1,
            "extratags": 1,
        }
        
        # Add viewbox if current location is provided (helps prioritize nearby results)
        if current_lat is not None and current_lon is not None:
            # Create a bounding box around current location (±0.1 degrees ≈ 11km)
            params["viewbox"] = f"{current_lon - 0.1},{current_lat + 0.1},{current_lon + 0.1},{current_lat - 0.1}"
            params["bounded"] = 0  # Don't strictly require results in viewbox
        
        headers = {
            "User-Agent": "Brain-Web-Calendar/1.0"  # Required by Nominatim
        }
        
        response = requests.get(NOMINATIM_BASE_URL, params=params, headers=headers, timeout=5)
        response.raise_for_status()
        
        results = response.json()
        
        formatted_results = []
        for item in results:
            # Extract address components
            address = item.get("address", {})
            display_name = item.get("display_name", "")
            
            # Build a cleaner display name
            name_parts = []
            if address.get("name"):
                name_parts.append(address["name"])
            elif address.get("building"):
                name_parts.append(address["building"])
            
            # Add location context
            if address.get("city") or address.get("town") or address.get("village"):
                city = address.get("city") or address.get("town") or address.get("village")
                if city not in name_parts:
                    name_parts.append(city)
            
            display_name_clean = ", ".join(name_parts) if name_parts else display_name.split(",")[0]
            
            result = {
                "name": display_name_clean,
                "full_address": display_name,
                "lat": float(item.get("lat", 0)),
                "lon": float(item.get("lon", 0)),
                "distance": None,
                "type": item.get("type", "place"),
            }
            
            # Calculate distance if current location provided
            if current_lat is not None and current_lon is not None:
                distance = _haversine_distance(
                    current_lat, current_lon,
                    result["lat"], result["lon"]
                )
                result["distance"] = round(distance, 1)
            
            formatted_results.append(result)
        
        return formatted_results
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Error calling Nominatim API: {str(e)}")
        return []
    except Exception as e:
        logger.error(f"Error processing Nominatim results: {str(e)}")
        return []


def search_locations_google_places(
    query: str,
    limit: int = 10,
    current_lat: Optional[float] = None,
    current_lon: Optional[float] = None,
) -> List[Dict[str, Any]]:
    """
    Search for locations using Google Places API (requires API key).
    
    Args:
        query: Search query
        limit: Maximum number of results
        current_lat: Current latitude
        current_lon: Current longitude
    
    Returns:
        List of location results
    """
    if not GOOGLE_PLACES_API_KEY:
        logger.warning("Google Places API key not configured, falling back to Nominatim")
        return search_locations_nominatim(query, limit, current_lat, current_lon)
    
    try:
        # Use Places API Text Search
        url = f"{GOOGLE_PLACES_BASE_URL}/textsearch/json"
        params = {
            "query": query,
            "key": GOOGLE_PLACES_API_KEY,
        }
        
        if current_lat is not None and current_lon is not None:
            params["location"] = f"{current_lat},{current_lon}"
            params["radius"] = 50000  # 50km radius
        
        response = requests.get(url, params=params, timeout=5)
        response.raise_for_status()
        
        data = response.json()
        if data.get("status") != "OK":
            logger.warning(f"Google Places API returned status: {data.get('status')}")
            return []
        
        results = data.get("results", [])[:limit]
        
        formatted_results = []
        for item in results:
            result = {
                "name": item.get("name", ""),
                "full_address": item.get("formatted_address", ""),
                "lat": item["geometry"]["location"]["lat"],
                "lon": item["geometry"]["location"]["lng"],
                "distance": None,
                "type": ", ".join(item.get("types", [])[:3]),
            }
            
            # Calculate distance if current location provided
            if current_lat is not None and current_lon is not None:
                distance = _haversine_distance(
                    current_lat, current_lon,
                    result["lat"], result["lon"]
                )
                result["distance"] = round(distance, 1)
            
            formatted_results.append(result)
        
        return formatted_results
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Error calling Google Places API: {str(e)}")
        # Fallback to Nominatim
        return search_locations_nominatim(query, limit, current_lat, current_lon)
    except Exception as e:
        logger.error(f"Error processing Google Places results: {str(e)}")
        return []


def search_locations(
    query: str,
    limit: int = 10,
    current_lat: Optional[float] = None,
    current_lon: Optional[float] = None,
    use_google: bool = False,
) -> List[Dict[str, Any]]:
    """
    Search for locations using geocoding API.
    
    Uses Google Places API if configured and use_google=True,
    otherwise uses OpenStreetMap Nominatim (free, no API key needed).
    
    Args:
        query: Search query
        limit: Maximum number of results
        current_lat: Current latitude for distance calculation
        current_lon: Current longitude for distance calculation
        use_google: Whether to use Google Places API (requires API key)
    
    Returns:
        List of location results with name, address, coordinates, and distance
    """
    if use_google and GOOGLE_PLACES_API_KEY:
        return search_locations_google_places(query, limit, current_lat, current_lon)
    else:
        return search_locations_nominatim(query, limit, current_lat, current_lon)

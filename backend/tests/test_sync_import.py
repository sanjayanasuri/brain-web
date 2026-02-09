#!/usr/bin/env python3
"""Test if sync router can be imported and has routes"""

try:
    from api_sync import router as sync_router
    print(f"✓ Router imported successfully")
    print(f"✓ Router prefix: {sync_router.prefix}")
    print(f"✓ Number of routes: {len(sync_router.routes)}")
    print(f"\nRoutes:")
    for route in sync_router.routes:
        if hasattr(route, 'path') and hasattr(route, 'methods'):
            methods = ', '.join(route.methods) if route.methods else 'N/A'
            print(f"  {methods:8} {route.path}")
    
    # Test the capture function import
    from services_sync_capture import capture_selection_into_graph
    print(f"\n✓ capture_selection_into_graph imported successfully")
    
except Exception as e:
    print(f"✗ ERROR: {e}")
    import traceback
    traceback.print_exc()


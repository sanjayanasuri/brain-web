"""
Mock helper classes for Neo4j testing.

These classes provide dict-like access to Neo4j records and results,
ensuring that rec["u"], rec["value"], rec["f"] work correctly in tests.
"""
from typing import List, Optional, Any


class MockNeo4jRecord:
    """Mock Neo4j record that supports __getitem__ for dictionary-style access."""
    def __init__(self, data_dict: dict):
        self._data = data_dict
    
    def __getitem__(self, key: str) -> Any:
        """Support dictionary-style access like rec['u'], rec['value'], rec['f']."""
        return self._data[key]
    
    def get(self, key: str, default: Any = None) -> Any:
        """Support .get() method like a dict."""
        return self._data.get(key, default)
    
    def data(self) -> dict:
        """Return the underlying data dictionary."""
        return self._data
    
    def keys(self):
        """Return keys like a dict."""
        return self._data.keys()
    
    def values(self):
        """Return values like a dict."""
        return self._data.values()
    
    def items(self):
        """Return items like a dict."""
        return self._data.items()


class MockNeo4jResult:
    """Mock Neo4j result that has a single() method and supports iteration."""
    def __init__(self, record: Optional[MockNeo4jRecord] = None, records: Optional[List[MockNeo4jRecord]] = None):
        """
        Initialize with either a single record or a list of records.
        
        Args:
            record: Single record for single() method
            records: List of records for iteration (if None, uses record if provided)
        """
        self._record = record
        if records is not None:
            self._records = records
        elif record is not None:
            self._records = [record]
        else:
            self._records = []
    
    def single(self) -> Optional[MockNeo4jRecord]:
        """Return a single record (or None)."""
        return self._record
    
    def consume(self):
        """Consume the result (used for write operations). Returns self for chaining."""
        return self
    
    def data(self) -> List[dict]:
        """Return data as list of dictionaries (used by SHOW CONSTRAINTS and similar queries)."""
        return [record.data() for record in self._records]
    
    def __iter__(self):
        """Support iteration over records."""
        return iter(self._records)
    
    def __len__(self):
        """Return the number of records."""
        return len(self._records)

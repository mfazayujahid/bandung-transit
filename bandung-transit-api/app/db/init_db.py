from sqlalchemy import text
from app.db.session import Base, engine
import app.models.transit

def init_db() -> None:
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
        conn.commit()
    Base.metadata.create_all(bind=engine)


if __name__ == "__main__":
    init_db()
    print("bandung_transit PostGIS tables initialized successfully.")

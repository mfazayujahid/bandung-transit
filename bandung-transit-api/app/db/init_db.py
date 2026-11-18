import logging
from sqlalchemy import text
from app.db.session import Base, engine, sessionLocal
import app.models.transit  # noqa: F401
from app.models.transit import Corridor

logger = logging.getLogger(__name__)


def init_db() -> None:
    with engine.connect() as conn:
        has_postgis = conn.execute(
            text("SELECT 1 FROM pg_extension WHERE extname = 'postgis';")
        ).scalar()
        if not has_postgis:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis;"))
            conn.commit()
    Base.metadata.create_all(bind=engine)


def seed_if_empty() -> None:
    """
    Automatically seeds Bandung BRT (MJT) + Commuter Line Bandung Raya corridors
    when starting against a brand-new empty cloud database (e.g., Supabase on Render).
    """
    with sessionLocal() as db:
        corridor_count = db.query(Corridor).count()
        if corridor_count > 0:
            logger.info("Database already contains %d corridors; skipping auto-seed.", corridor_count)
            return

        logger.info("Empty transit database detected — starting automatic initial seed...")
        from app.services.seeder import seed_transit_network
        from app.services.rail_seeder import seed_commuter_line

        try:
            seed_transit_network(db)
            seed_commuter_line(db)
            logger.info("Automatic initial seed completed successfully.")
        except Exception as exc:
            logger.exception("Automatic initial seed failed: %s", exc)


if __name__ == "__main__":
    init_db()
    print("bandung_transit PostGIS tables initialized successfully.")

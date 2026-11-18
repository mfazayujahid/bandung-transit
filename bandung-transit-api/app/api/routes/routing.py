from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.services.router import plan_trip

router = APIRouter(prefix="/api/routing", tags=["Routing"])


@router.get("/plan")
def get_trip_plan(
    origin_lng: float = Query(..., ge=-180, le=180),
    origin_lat: float = Query(..., ge=-90, le=90),
    dest_lng: float = Query(..., ge=-180, le=180),
    dest_lat: float = Query(..., ge=-90, le=90),
    db: Session = Depends(get_db),
):
    result = plan_trip(db, origin_lng, origin_lat, dest_lng, dest_lat)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result